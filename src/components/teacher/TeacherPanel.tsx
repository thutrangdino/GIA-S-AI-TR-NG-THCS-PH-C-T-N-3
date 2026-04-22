import { useState, useEffect } from "react";
import { Upload, FileText, CheckCircle, AlertCircle, Loader2, Database, Trash2, Image as ImageIcon } from "lucide-react";
import { motion } from "motion/react";
import { db, handleFirestoreError } from "../../lib/firebase";
import { collection, addDoc, serverTimestamp, getDocs, deleteDoc, doc } from "firebase/firestore";

export default function TeacherPanel({ 
  schoolLogo, 
  onLogoUpload, 
  isUploadingLogo 
}: { 
  schoolLogo: string | null;
  onLogoUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  isUploadingLogo: boolean;
}) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "success" | "error">("idle");
  const [documents, setDocuments] = useState<any[]>([]);

  useEffect(() => {
    fetchDocuments();
  }, []);

  const fetchDocuments = async () => {
    try {
      const snap = await getDocs(collection(db, "documents"));
      setDocuments(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      handleFirestoreError(err, 'list', 'documents');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadStatus("idle");

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64Data = event.target?.result as string;
      try {
        const response = await fetch("/api/extract-text", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileData: base64Data,
            fileName: file.name,
            mimeType: file.type
          })
        });

        if (!response.ok) throw new Error("Extraction failed");
        
        const { text } = await response.json();
        
        // --- UPGRADE: CHUNKING LOGIC ---
        const splitIntoChunks = (rawText: string, size = 600) => {
           const sentences = rawText.split(/(?<=[.!?])\s+/);
           let chunks: string[] = [];
           let current = "";

           for (let s of sentences) {
             if ((current + s).length < size) {
               current += s + " ";
             } else {
               chunks.push(current.trim());
               current = s + " ";
             }
           }
           if (current) chunks.push(current.trim());
           return chunks;
        };

        const chunks = splitIntoChunks(text);
        
        // Save metadata to 'documents'
        const docRef = await addDoc(collection(db, "documents"), {
          title: file.name,
          chunkCount: chunks.length,
          type: file.type.split("/")[1] || "txt",
          uploadedAt: serverTimestamp()
        });

        // Save pieces to 'knowledge_base'
        const savePromises = chunks.map(chunkContent => 
           addDoc(collection(db, "knowledge_base"), {
              docId: docRef.id,
              docTitle: file.name,
              content: chunkContent,
              length: chunkContent.length,
              source: "teacher_upload"
           })
        );

        await Promise.all(savePromises);
        // --- END UPGRADE ---

        await fetchDocuments();
        setUploadStatus("success");
      } catch (error) {
        console.error(error);
        setUploadStatus("error");
      } finally {
        setIsUploading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const clearDatabase = async () => {
    if (!confirm("Bạn có chắc chắn muốn xóa tất cả tài liệu? Hệ thống học tập sẽ trống trơn!")) return;
    try {
      // Clear documents metadata
      const snap = await getDocs(collection(db, "documents"));
      const deleteDocsPromises = snap.docs.map(d => deleteDoc(doc(db, "documents", d.id)));
      
      // Clear knowledge base chunks
      const kbSnap = await getDocs(collection(db, "knowledge_base"));
      const deleteKbPromises = kbSnap.docs.map(d => deleteDoc(doc(db, "knowledge_base", d.id)));

      await Promise.all([...deleteDocsPromises, ...deleteKbPromises]);
      await fetchDocuments();
    } catch (err) {
      handleFirestoreError(err, 'delete', 'documents');
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 custom-scrollbar">

      {/* School Logo Section - UPLOAD & FIX */}
      <div className="bg-white rounded-3xl p-8 border border-sky-100 card-shadow">
         <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 bg-sky-50 rounded-2xl flex items-center justify-center text-sky-600 font-bold border border-sky-100">
               <ImageIcon size={24} />
            </div>
            <h3 className="font-display font-bold text-sky-900 text-xl tracking-tight">Cập Nhật Logo Trường</h3>
         </div>
         <p className="text-sm text-black mb-6 leading-relaxed font-bold">
            Hãy tải lên Logo chính thức của trường. Sau khi tải lên, hệ thống sẽ tự động cập nhật cho toàn bộ trang web.
         </p>
         <div className="flex items-center gap-6">
            <div className="w-32 h-32 rounded-2xl border-4 border-sky-50 shadow-sm flex items-center justify-center bg-white overflow-hidden shrink-0 p-2">
               {isUploadingLogo ? (
                  <Loader2 className="animate-spin text-sky-600" size={24} />
               ) : schoolLogo ? (
                  <img src={schoolLogo} alt="School Logo" className="w-full h-full object-contain" />
               ) : (
                  <span className="text-xs font-black text-black">Chưa có</span>
               )}
            </div>
            <div className="flex flex-col gap-3">
               <label className="bg-sky-600 hover:bg-sky-700 text-white font-bold py-3 px-6 rounded-xl cursor-pointer transition-all shadow-lg flex items-center gap-2 w-fit">
                  <Upload size={18} />
                  {schoolLogo ? "Thay đổi Logo mới" : "Tải lên Logo ngay"}
                  <input 
                     type="file" 
                     className="hidden" 
                     accept="image/*" 
                     onChange={onLogoUpload} 
                     disabled={isUploadingLogo}
                  />
               </label>
               {schoolLogo && (
                  <div className="bg-green-50 text-green-700 font-bold py-2 px-4 rounded-xl border border-green-100 flex items-center gap-2 text-[10px] uppercase italic">
                     <CheckCircle size={14} />
                     Đã thiết lập logo thành công
                  </div>
               )}
            </div>
         </div>
      </div>

      {/* RAG Section */}
      <div className="bg-white rounded-3xl p-8 border border-sky-100 card-shadow">
         <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 bg-sky-50 rounded-2xl flex items-center justify-center text-sky-600 font-bold border border-sky-100">
               <Upload size={24} />
            </div>
            <h3 className="font-display font-bold text-sky-900 text-xl tracking-tight">Quản lý tri thức AI (RAG)</h3>
         </div>

         <p className="text-sm text-black mb-8 leading-relaxed font-bold">
            Tải lên tài liệu để bồi dưỡng kiến thức cho Gia sư AI. Hệ thống sẽ ưu tiên sử dụng dữ liệu này để trả lời học sinh.
         </p>

         <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="relative group">
               <input 
                 type="file" 
                 onChange={handleFileUpload}
                 accept=".pdf,.docx,.txt"
                 className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                 disabled={isUploading}
               />
               <div className="border-2 border-dashed border-sky-100/50 rounded-3xl p-12 flex flex-col items-center justify-center gap-4 group-hover:bg-sky-50/50 group-hover:border-sky-400/50 transition-all cursor-pointer bg-slate-50/30">
                  {isUploading ? (
                    <Loader2 className="animate-spin text-sky-500" size={40} />
                  ) : (
                    <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center text-sky-600 shadow-sm border border-sky-50">
                       <FileText size={32} />
                    </div>
                  )}
                  <div className="text-center">
                    <p className="font-bold text-sky-900">
                      {isUploading ? "Đang nạp tri thức..." : "Kéo thả giáo án vào đây"}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-2 uppercase font-bold tracking-widest">Hỗ trợ PDF, Word, TXT</p>
                  </div>
               </div>
               
               {uploadStatus === "success" && (
                 <div className="mt-4 flex items-center gap-2 text-sky-600 font-bold text-xs bg-sky-50 p-4 rounded-2xl border border-sky-100">
                    <CheckCircle size={16} /> Tài liệu đã được nạp thành công!
                 </div>
               )}
               {uploadStatus === "error" && (
                 <div className="mt-4 flex items-center gap-2 text-red-500 font-bold text-xs bg-red-50 p-4 rounded-2xl border border-red-100">
                    <AlertCircle size={16} /> Có lỗi khi xử lý tài liệu.
                 </div>
               )}
            </div>

            <div className="flex flex-col gap-4">
               <div className="bg-slate-50 rounded-3xl p-6 border border-slate-100 flex-1 flex flex-col overflow-hidden">
                  <div className="flex items-center justify-between mb-4">
                     <div className="flex items-center gap-2 text-black font-black text-xs uppercase tracking-wider">
                        <Database size={14} />
                        Tri thức ({documents.length})
                     </div>
                     <button 
                       onClick={clearDatabase}
                       className="text-[10px] font-bold text-red-500 hover:bg-red-50 px-3 py-1 rounded-lg transition-all border border-red-100"
                     >
                        Xóa tất cả
                     </button>
                  </div>
                  <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 mt-4">
                     <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                        {documents.map((doc: any) => (
                          <motion.div 
                            whileHover={{ y: -5, scale: 1.02 }}
                            key={doc.id} 
                            className="bg-white p-5 rounded-3xl border border-sky-50 flex flex-col items-center text-center gap-3 shadow-sm hover:shadow-xl hover:border-sky-300 transition-all group relative overflow-hidden"
                          >
                             <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <AlertCircle size={14} className="text-sky-300" />
                             </div>
                             <div className="w-14 h-14 rounded-2xl bg-sky-50 flex items-center justify-center text-sky-500 group-hover:bg-sky-600 group-hover:text-white transition-all shadow-inner">
                                <FileText size={28} />
                             </div>
                             <div className="w-full">
                                <p className="text-[11px] font-black text-sky-900 truncate px-1">{doc.title}</p>
                                <div className="mt-2 flex items-center justify-center gap-1.5 font-sans">
                                   <span className="px-2 py-0.5 bg-sky-50 text-sky-600 rounded text-[8px] font-black uppercase tracking-tighter border border-sky-100">{doc.type}</span>
                                   <span className="px-2 py-0.5 bg-slate-50 text-slate-400 rounded text-[8px] font-bold border border-slate-100">{(doc.chunkCount || 1)} mảnh</span>
                                </div>
                             </div>
                          </motion.div>
                        ))}
                     </div>
                     {documents.length === 0 && (
                        <div className="text-center py-20 bg-white/50 rounded-3xl border border-dashed border-slate-200">
                           <Database size={40} className="mx-auto text-slate-200 mb-4" />
                           <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Hệ thống tri thức đang trống</p>
                        </div>
                     )}
                  </div>
               </div>
            </div>
         </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard label="Tri thức đã nạp" value={`${(documents.reduce((acc, d) => acc + d.content.length, 0) / 1024).toFixed(1)} KB`} color="sky" />
          <StatCard label="Tổng tài liệu" value={documents.length.toString()} color="blue" />
          <StatCard label="Học sinh online" value="48" color="indigo" />
      </div>
    </div>
  );
}



function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  const colors: Record<string, string> = {
    sky: "text-sky-600 bg-sky-50",
    blue: "text-blue-600 bg-blue-50",
    indigo: "text-indigo-600 bg-indigo-50"
  };

  return (
    <div className="bg-white rounded-3xl p-6 border border-sky-50 card-shadow flex items-center justify-between">
       <div>
          <p className="text-xs font-black text-black uppercase tracking-widest mb-1">{label}</p>
          <p className={`text-2xl font-display font-extrabold ${colors[color].split(" ")[0]}`}>{value}</p>
       </div>
       <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${colors[color].split(" ")[1]} ${colors[color].split(" ")[0]}`}>
          <Database size={24} />
       </div>
    </div>
  );
}
