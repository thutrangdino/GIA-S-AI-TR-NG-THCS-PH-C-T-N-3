import { useState, useRef, useEffect } from "react";
import { Send, Image as ImageIcon, Mic, Loader2, Bot, User as UserIcon, XCircle, FileText, Upload } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { askGiaSu, getRelevantContext } from "../../lib/gemini";
import { cn, processLaTeX } from "../../lib/utils";
import { db, handleFirestoreError } from "../../lib/firebase";
import { collection, addDoc, onSnapshot, query, where, orderBy, serverTimestamp, getDocs } from "firebase/firestore";
import { speechService } from "../../lib/speechService";

interface Message {
  role: "user" | "model";
  content: string;
  timestamp: any;
  studentId: string;
}

export default function ChatInterface({ studentName, addXP, userId }: { studentName: string; addXP: (xp: number) => void; userId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [selectedImage, setSelectedImage] = useState<{ data: string; mimeType: string } | null>(null);
  const [selectedFile, setSelectedFile] = useState<{ name: string; content: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [context, setContext] = useState("");

  useEffect(() => {
    // Fetch RAG context from Firestore
    const fetchContext = async () => {
      try {
        const docsSnap = await getDocs(collection(db, "documents"));
        const docsText = docsSnap.docs.map(d => d.data().content).join("\n\n");
        setContext(docsText);
      } catch (err) {
        handleFirestoreError(err, 'list', 'documents');
      }
    };
    fetchContext();

    // Listen to messages
    const q = query(
      collection(db, "messages"),
      where("studentId", "==", userId),
      orderBy("timestamp", "asc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => doc.data() as Message);
      if (msgs.length === 0) {
         setMessages([{ 
            role: "model", 
            content: `Chào mừng bạn **${studentName}** đến với Gia sư AI KHTN! 👋\n\nCô là trợ lý giúp em học tốt môn Khoa học Tự nhiên. Hôm nay em muốn khám phá điều gì cùng cô nào?`,
            timestamp: new Date(),
            studentId: userId
         }]);
      } else {
         setMessages(msgs);
      }
    }, (error) => {
      handleFirestoreError(error, 'list', 'messages');
    });

    return () => unsubscribe();
  }, [userId, studentName]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if ((!input.trim() && !selectedImage && !selectedFile) || isLoading) return;

    const userText = input;
    const currentImage = selectedImage;
    const currentFile = selectedFile;
    
    setInput("");
    setSelectedImage(null);
    setSelectedFile(null);
    setIsLoading(true);

    try {
      // 1. Retrieval relevant context
      const relevantContext = await getRelevantContext(userText || "Phân tích nội dung đính kèm");
      
      let finalPrompt = userText;
      if (currentFile) {
        finalPrompt = `Dựa trên tài liệu đính kèm ("${currentFile.name}"): \n\n${currentFile.content}\n\nHọc sinh hỏi: ${userText || "Hãy giải bài tập/tóm tắt tài liệu này."}`;
      }

      // 2. Save user message
      try {
        await addDoc(collection(db, "messages"), {
          studentId: userId,
          role: "user",
          content: userText || (currentImage ? "🖼️ Bạn đã gửi một hình ảnh." : (currentFile ? `📂 Tài liệu: ${currentFile.name}` : "")),
          timestamp: serverTimestamp()
        });
      } catch (err) {
        handleFirestoreError(err, 'create', 'messages');
      }

      // 3. Chat with Gemini using relevantContext
      const history = messages.map(m => ({ role: m.role, parts: [{ text: m.content }] }));
      const response = await askGiaSu(finalPrompt, history, relevantContext, currentImage || undefined);
      
      // 3. Save AI message
      try {
        await addDoc(collection(db, "messages"), {
          studentId: userId,
          role: "model",
          content: response || "",
          timestamp: serverTimestamp()
        });
      } catch (err) {
        handleFirestoreError(err, 'create', 'messages');
      }

      addXP(5);
    } catch (error) {
      console.error(error);
      await addDoc(collection(db, "messages"), {
        studentId: userId,
        role: "model",
        content: "❗ Có lỗi xảy ra, cô chưa thể trả lời ngay lúc này.",
        timestamp: serverTimestamp()
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage({
          data: (reader.result as string).split(",")[1],
          mimeType: file.type
        });
      };
      reader.readAsDataURL(file);
    } else {
      // PDF, Docx or Text
      setIsLoading(true);
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = (reader.result as string);
        try {
          const response = await fetch("/api/extract-text", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fileData: base64,
              fileName: file.name,
              mimeType: file.type
            })
          });
          const data = await response.json();
          if (data.text) {
            setSelectedFile({
              name: file.name,
              content: data.text
            });
          } else {
            alert(data.error || "Không thể trích xuất văn bản từ tài liệu này.");
          }
        } catch (error) {
          console.error("File upload error:", error);
          alert("Lỗi kết nối máy chủ khi xử lý tài liệu.");
        } finally {
          setIsLoading(false);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const toggleRecording = () => {
    if (!isRecording) {
      speechService.start(
        (text) => {
          setInput(prev => (prev ? `${prev} ${text}` : text));
        },
        (error) => {
          console.error("Speech error:", error);
          setIsRecording(false);
        },
        () => {
          setIsRecording(false);
        }
      );
      setIsRecording(true);
    } else {
      speechService.stop();
      setIsRecording(false);
    }
  };

  return (
    <div className="flex flex-col h-full max-w-4xl mx-auto relative">
      <div className="flex-1 overflow-y-auto space-y-6 pb-32 px-2 custom-scrollbar">
        {messages.map((msg, idx) => (
          <div key={idx} className={cn(
            "flex gap-3 group",
            msg.role === "user" ? "flex-row-reverse" : "flex-row"
          )}>
            <div className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center shrink-0 border shadow-sm",
              msg.role === "user" ? "bg-black text-white border-white" : "bg-sky-600 text-white border-sky-500"
            )}>
              {msg.role === "user" ? <span className="text-[10px] font-bold">Tôi</span> : <Bot size={16} />}
            </div>
            
            <div className={cn(
              "max-w-[85%] rounded-2xl p-4 md:p-5 card-shadow",
              msg.role === "user" 
                ? "bg-white text-black font-bold rounded-tr-none border border-slate-100" 
                : "bg-sky-50 text-sky-950 font-bold rounded-tl-none border border-sky-100"
            )}>
              <div className={cn(
                "markdown-body text-sm leading-relaxed",
                msg.role === "user" ? "" : "prose-sky message-content"
              )}>
                <ReactMarkdown 
                  remarkPlugins={[remarkMath]} 
                  rehypePlugins={[rehypeKatex]}
                >
                  {processLaTeX(msg.content)}
                </ReactMarkdown>
              </div>
              <p className={cn(
                "text-[9px] mt-3 opacity-40 font-bold uppercase tracking-wider",
                msg.role === "user" ? "text-right" : "text-left"
              )}>
                {msg.timestamp?.toDate ? msg.timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "Đang gửi..."}
              </p>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex gap-3 animate-pulse">
            <div className="w-8 h-8 rounded-full bg-sky-100 border border-sky-200" />
            <div className="bg-sky-50 border border-sky-100 rounded-2xl p-5 h-20 w-64 card-shadow flex items-center gap-3">
               <Loader2 className="animate-spin text-sky-600" size={18} />
               <span className="text-xs font-bold text-sky-700">Gia sư đang suy nghĩ...</span>
            </div>
          </div>
        )}
        <div ref={scrollRef} />
      </div>

      {/* Input Area */}
      <div className="absolute bottom-0 left-0 right-0 p-4 bg-sky-50/80 backdrop-blur-md mb-2">
        <div className="w-[85%] md:w-full max-w-4xl mx-auto">
          <div className="flex gap-2 mb-2 flex-wrap">
            {selectedImage && (
              <div className="p-2 bg-white rounded-xl border border-sky-100 inline-flex items-center gap-2 shadow-sm animate-in fade-in slide-in-from-bottom-2">
                <div className="w-10 h-10 rounded-lg overflow-hidden bg-slate-100">
                    <img src={`data:${selectedImage.mimeType};base64,${selectedImage.data}`} alt="Preview" className="w-full h-full object-cover" />
                </div>
                <button onClick={() => setSelectedImage(null)} className="text-red-500 p-1 hover:bg-red-50 rounded-md transition-colors">
                    <XCircle size={16} />
                </button>
              </div>
            )}
            {selectedFile && (
              <div className="p-2 bg-sky-50 rounded-xl border border-sky-100 inline-flex items-center gap-2 shadow-sm animate-in fade-in slide-in-from-bottom-2">
                <div className="w-10 h-10 rounded-lg bg-sky-600 flex items-center justify-center text-white">
                    <FileText size={20} />
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-sky-800 max-w-[150px] truncate">{selectedFile.name}</span>
                  <span className="text-[8px] text-sky-600 uppercase font-black">Tài liệu đã tải</span>
                </div>
                <button onClick={() => setSelectedFile(null)} className="text-red-500 p-1 hover:bg-red-50 rounded-md transition-colors">
                    <XCircle size={16} />
                </button>
              </div>
            )}
          </div>
          
          <div className={cn(
            "bg-white p-2 rounded-2xl border transition-all flex items-center gap-1",
            isRecording ? "border-red-500 shadow-red-100 ring-4 ring-red-50" : "border-sky-200 shadow-lg"
          )}>
             <input 
               type="file" 
               className="hidden" 
               ref={fileInputRef} 
               accept="image/*,.pdf,.doc,.docx,text/plain"
               onChange={handleFileChange}
             />
             <button 
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading}
                className="p-2 text-sky-600 hover:bg-sky-50 rounded-xl transition-all disabled:opacity-50"
                title="Tải lên hình ảnh/tài liệu"
             >
                <Upload size={20} />
             </button>
             <button 
                onClick={toggleRecording}
                disabled={isLoading}
                className={cn(
                  "p-2 rounded-xl transition-all",
                  isRecording ? "text-red-500 animate-pulse bg-red-50" : "text-sky-600 hover:bg-sky-50"
                )}
                title={isRecording ? "Dừng ghi âm" : "Ghi âm câu hỏi"}
             >
                <Mic size={20} />
             </button>
             <input 
               type="text" 
               value={input}
               onChange={(e) => setInput(e.target.value)}
               onKeyDown={(e) => e.key === "Enter" && handleSend()}
               placeholder={isRecording ? "Đang nghe em nói..." : (isLoading ? "Đang xử lý..." : "Nhập câu hỏi của em tại đây...")}
               className="flex-1 bg-transparent px-3 py-2 outline-none font-bold text-black text-sm focus:ring-0 disabled:opacity-50"
               disabled={isLoading}
             />
             <button 
               onClick={handleSend}
               disabled={(!input.trim() && !selectedImage && !selectedFile) || isLoading}
               className="bg-sky-600 text-white px-5 py-2 rounded-xl hover:bg-sky-700 disabled:opacity-50 shadow-md transition-all active:scale-95 text-sm font-bold flex items-center gap-2"
             >
               {isLoading ? <Loader2 size={16} className="animate-spin" /> : "Gửi"}
             </button>
          </div>
        </div>
      </div>
    </div>
  );
}


