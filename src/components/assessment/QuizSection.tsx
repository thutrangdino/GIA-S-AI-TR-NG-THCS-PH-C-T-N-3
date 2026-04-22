import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  BookOpen, 
  HelpCircle, 
  CheckCircle2, 
  XCircle, 
  ChevronRight, 
  RefreshCw, 
  Trophy, 
  Loader2, 
  MessageSquare,
  Image as ImageIcon,
  Send,
  Upload,
  ArrowLeft,
  History,
  Clock,
  Layers,
  Brain,
  Zap,
  Sparkles,
  AlertCircle
} from "lucide-react";
import { generateQuiz, generateFlashcards, generateMindmap, analyzePerformance, evaluateEssay } from "../../lib/gemini";
import { cn } from "../../lib/utils";
import confetti from "canvas-confetti";
import { db, handleFirestoreError } from "../../lib/firebase";
import { collection, addDoc, getDocs, serverTimestamp, query, where, orderBy, limit, onSnapshot, Timestamp } from "firebase/firestore";
import ChatInterface from "../chat/ChatInterface";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { processLaTeX } from "../../lib/utils";

interface Quiz {
  question: string;
  options?: string[]; // Optional for essay
  answerIndex?: number; // Optional for essay
  explanation: string;
  hint?: string;
  difficulty?: string;
}

interface Flashcard {
  front: string;
  back: string;
}

interface MindmapNode {
  id: string;
  label: string;
  parentId: string | null;
}

interface QuizHistory {
  id: string;
  topic: string;
  score: number;
  total: number;
  createdAt: Timestamp | null;
}

export default function QuizSection({ studentName, addXP, userId }: { studentName: string; addXP: (xp: number) => void; userId: string }) {
  const [mode, setMode] = useState<"menu" | "quiz" | "chat" | "history" | "flashcard" | "mindmap">("menu");
  const [topic, setTopic] = useState("");
  const [grade, setGrade] = useState("");
  const [quizType, setQuizType] = useState("Trắc nghiệm");
  const [quizCount, setQuizCount] = useState(5);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [mindmapNodes, setMindmapNodes] = useState<MindmapNode[]>([]);
  const [history, setHistory] = useState<QuizHistory[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [direction, setDirection] = useState(0);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [score, setScore] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [context, setContext] = useState("");
  const [essayAnswer, setEssayAnswer] = useState("");
  const [isGrading, setIsGrading] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [showHint, setShowHint] = useState(false);
  const [hintUsed, setHintUsed] = useState(false);
  const [essayImage, setEssayImage] = useState<{data: string, mimeType: string} | null>(null);
  const [essayFeedback, setEssayFeedback] = useState<{isPassing: boolean, feedback: string, score: number} | null>(null);
  const [results, setResults] = useState<boolean[]>([]);
  const [performanceReport, setPerformanceReport] = useState<any>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [timeLeft, setTimeLeft] = useState(45);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode === "quiz" && !isAnswered && quizzes.length > 0 && !isLoading && !isFinished) {
      if (timerRef.current) clearInterval(timerRef.current);
      setTimeLeft(45);
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timerRef.current!);
            // Handle timeout - treat as incorrect
            handleTimeout();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [mode, currentIdx, isAnswered, isLoading, isFinished]);

  const handleTimeout = () => {
    if (isAnswered) return;
    setIsAnswered(true);
    setResults(prev => [...prev, false]);
    setSelectedIdx(-1); // No selection
  };

  useEffect(() => {
    const fetchContext = async () => {
      try {
        const kbSnap = await getDocs(query(collection(db, "knowledge_base"), limit(30)));
        const docsText = kbSnap.docs.map(d => d.data().content).join("\n\n");
        setContext(docsText);
      } catch (err) {
        handleFirestoreError(err, 'list', 'knowledge_base');
      }
    };
    fetchContext();
  }, []);

  useEffect(() => {
    if (!userId) return;
    const q = query(
      collection(db, "quizzes"),
      where("studentId", "==", userId),
      orderBy("createdAt", "desc"),
      limit(20)
    );

    const unsubscribe = onSnapshot(q, (snap) => {
      const historyList = snap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as QuizHistory[];
      setHistory(historyList);
    });

    return () => unsubscribe();
  }, [userId]);

  const startQuiz = async () => {
    if (!topic.trim()) return;
    setIsLoading(true);
    setQuizzes([]);
    setErrorMsg("");
    setCurrentIdx(0);
    setScore(0);
    setIsFinished(false);
    setEssayAnswer("");
    setEssayImage(null);
    setEssayFeedback(null);
    setSelectedIdx(null);
    setIsAnswered(false);
    setMode("quiz");
    
    try {
      const result = await generateQuiz(topic, context, grade, quizType, quizCount);
      if (result.error) {
        setErrorMsg(result.error);
        setMode("menu");
      } else {
        setQuizzes(result.quizzes || []);
      }
    } catch (error) {
      console.error(error);
      setErrorMsg("❗ Không thể khởi tạo bài tập. Vui lòng thử lại.");
      setMode("menu");
    } finally {
      setIsLoading(false);
    }
  };

  const createFlashcards = async () => {
    if (!topic.trim() || !grade) return;
    setIsLoading(true);
    setCurrentIdx(0);
    setDirection(0);
    try {
      const result = await generateFlashcards(topic, context, grade);
      setFlashcards(result.flashcards || []);
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const paginate = (newDirection: number) => {
    setDirection(newDirection);
    setCurrentIdx(prev => prev + newDirection);
  };

  const createMindmap = async () => {
    if (!topic.trim() || !grade) return;
    setIsLoading(true);
    try {
      const result = await generateMindmap(topic, context, grade);
      setMindmapNodes(result.mindmap || []);
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAnswer = (idx: number) => {
    if (isAnswered) return;
    if (timerRef.current) clearInterval(timerRef.current);
    setSelectedIdx(idx);
    
    if (idx === quizzes[currentIdx].answerIndex) {
      setIsAnswered(true);
      setScore(prev => prev + 1);
      setResults(prev => [...prev, true]);
      const baseXP = quizzes[currentIdx].difficulty === "Khó" ? 20 : (quizzes[currentIdx].difficulty === "Trung bình" ? 15 : 10);
      const bonusXP = (attempts === 1 && !showHint) ? 0 : (attempts === 1 ? 5 : 0);
      addXP(baseXP + bonusXP);
    } else {
      if (attempts === 0) {
        setAttempts(1);
        setShowHint(true);
        setHintUsed(true);
        // Don't show original selected as "final" yet, let them try again
      } else {
        setIsAnswered(true);
        setResults(prev => [...prev, false]);
      }
    }
  };

  const submitEssay = async () => {
    if (isAnswered || (!essayAnswer.trim() && !essayImage)) return;
    if (timerRef.current) clearInterval(timerRef.current);
    setIsGrading(true);
    
    try {
      const evaluation = await evaluateEssay(quizzes[currentIdx].question, essayAnswer, essayImage || undefined);
      setEssayFeedback(evaluation);
      
      if (evaluation.isPassing) {
         setIsAnswered(true);
         setScore(prev => prev + 1);
         setResults(prev => [...prev, true]);
         addXP(20);
      } else {
         if (attempts === 0) {
           setAttempts(1);
           setShowHint(true);
           setHintUsed(true);
         } else {
           setIsAnswered(true);
           setResults(prev => [...prev, false]);
         }
      }
    } catch (e) {
      console.error(e);
      alert("Lỗi chấm bài. Em thử lại nhé!");
    }
    
    setIsGrading(false);
  };

  const nextQuestion = async () => {
    if (currentIdx < quizzes.length - 1) {
      setCurrentIdx(prev => prev + 1);
      setSelectedIdx(null);
      setIsAnswered(false);
      setEssayAnswer("");
      setEssayImage(null);
      setEssayFeedback(null);
      setAttempts(0);
      setShowHint(false);
    } else {
      setIsFinished(true);
      setLoadingReport(true);
      
      try {
        const report = await analyzePerformance(topic, results.map((res, i) => ({
          question: quizzes[i].question,
          correct: res
        })), "Tài liệu học tập");
        setPerformanceReport(report);

        await addDoc(collection(db, "quizzes"), {
          studentId: userId,
          topic,
          score,
          total: quizzes.length,
          performance: report,
          createdAt: serverTimestamp()
        });
      } catch (err) {
        console.error(err);
      } finally {
        setLoadingReport(false);
      }

      if (score >= quizzes.length / 2) {
        confetti({
          particleCount: 150,
          spread: 70,
          origin: { y: 0.6 },
          colors: ["#0d9488", "#14b8a6", "#5eead4"]
        });
      }
    }
  };

  if (mode === "chat") {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-4 mb-4">
          <button 
            onClick={() => setMode("menu")}
            className="p-2 hover:bg-sky-50 rounded-xl text-sky-600 transition-all border border-sky-100"
          >
            <ArrowLeft size={20} />
          </button>
          <h3 className="font-display font-black text-sky-900 tracking-tight">Trợ lý học tập thông minh</h3>
        </div>
        <ChatInterface studentName={studentName} addXP={addXP} userId={userId} />
      </div>
    );
  }

  if (mode === "flashcard") {
    return (
      <div className="flex flex-col h-full bg-orange-50/10 rounded-[2.5rem] p-8 border border-orange-100/50">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => { setMode("menu"); setFlashcards([]); }}
              className="p-2 hover:bg-white rounded-xl text-orange-600 transition-all border border-orange-100 bg-white/50"
            >
              <ArrowLeft size={20} />
            </button>
            <h3 className="font-display font-black text-orange-900 text-xl tracking-tight uppercase">Học qua Flashcards</h3>
          </div>
          {flashcards.length > 0 && (
             <button 
               onClick={() => setFlashcards([])}
               className="text-[10px] font-black text-orange-600 uppercase tracking-widest hover:underline"
             >
               Đổi chủ đề
             </button>
          )}
        </div>

        {flashcards.length === 0 ? (
          <div className="flex-1 flex flex-col justify-center max-w-md mx-auto w-full space-y-6">
            <div className="text-center space-y-2 mb-4">
               <div className="w-16 h-16 bg-orange-100 rounded-2xl flex items-center justify-center text-orange-600 mx-auto shadow-sm">
                  <Layers size={32} />
               </div>
               <p className="text-orange-700 font-bold">Hãy nhập thông tin để AI tạo bộ thẻ cho em</p>
            </div>
            
            <div className="space-y-4">
               <select 
                  value={grade}
                  onChange={(e) => setGrade(e.target.value)}
                  className="w-full bg-white border-2 border-orange-100 rounded-2xl px-6 py-4 outline-none focus:border-orange-500 font-bold text-orange-900"
               >
                  <option value="">Chọn khối lớp...</option>
                  <option value="6">Khối 6</option>
                  <option value="7">Khối 7</option>
                  <option value="8">Khối 8</option>
                  <option value="9">Khối 9</option>
               </select>
               <input 
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="Nhập bài học/chủ đề..."
                  className="w-full bg-white border-2 border-orange-100 rounded-2xl px-6 py-4 outline-none focus:border-orange-500 font-bold text-orange-900"
               />
               <button 
                  onClick={createFlashcards}
                  disabled={!topic.trim() || !grade}
                  className="w-full bg-orange-500 text-white font-black py-5 rounded-2xl shadow-xl shadow-orange-200 hover:bg-orange-600 transition-all disabled:opacity-50"
               >
                  TẠO FLASHCARDS
               </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center space-y-12">
             <div className="relative w-full max-w-sm h-80 perspective-1000 group">
                <AnimatePresence mode="wait" custom={direction}>
                  <motion.div
                    key={currentIdx}
                    custom={direction}
                    variants={{
                      enter: (direction: number) => ({
                        x: direction > 0 ? 50 : -50,
                        opacity: 0,
                        scale: 0.9
                      }),
                      center: {
                        zIndex: 1,
                        x: 0,
                        opacity: 1,
                        scale: 1
                      },
                      exit: (direction: number) => ({
                        zIndex: 0,
                        x: direction < 0 ? 50 : -50,
                        opacity: 0,
                        scale: 0.9
                      })
                    }}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{
                      x: { type: "spring", stiffness: 300, damping: 30 },
                      opacity: { duration: 0.2 }
                    }}
                    className="w-full h-full relative"
                  >
                    <FlashcardItem card={flashcards[currentIdx]} />
                  </motion.div>
                </AnimatePresence>
             </div>

             <div className="flex items-center gap-8">
                <button 
                  disabled={currentIdx === 0}
                  onClick={() => paginate(-1)}
                  className="p-4 bg-white rounded-2xl shadow-md border border-orange-100 text-orange-600 disabled:opacity-30 hover:bg-orange-50 transition-colors"
                >
                  <ArrowLeft size={24} />
                </button>
                <div className="text-center">
                   <p className="text-2xl font-black text-orange-900">{currentIdx + 1} <span className="text-orange-300 mx-1">/</span> {flashcards.length}</p>
                   <p className="text-[10px] font-black text-orange-400 uppercase tracking-widest mt-1">SỐ THẺ</p>
                </div>
                <button 
                  disabled={currentIdx === flashcards.length - 1}
                  onClick={() => paginate(1)}
                  className="p-4 bg-white rounded-2xl shadow-md border border-orange-100 text-orange-600 disabled:opacity-30 hover:bg-orange-50 transition-colors"
                >
                  <ChevronRight size={24} />
                </button>
             </div>
          </div>
        )}
      </div>
    );
  }

  if (mode === "mindmap") {
    return (
      <div className="flex flex-col h-full bg-blue-50/10 rounded-[2.5rem] p-8 border border-blue-100/50">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => { setMode("menu"); setMindmapNodes([]); }}
              className="p-2 hover:bg-white rounded-xl text-blue-600 transition-all border border-blue-100 bg-white/50"
            >
              <ArrowLeft size={20} />
            </button>
            <h3 className="font-display font-black text-blue-900 text-xl tracking-tight uppercase">Mindmap AI</h3>
          </div>
          {mindmapNodes.length > 0 && (
             <button 
               onClick={() => setMindmapNodes([])}
               className="text-[10px] font-black text-blue-600 uppercase tracking-widest hover:underline"
             >
               Vẽ sơ đồ khác
             </button>
          )}
        </div>

        {mindmapNodes.length === 0 ? (
          <div className="flex-1 flex flex-col justify-center max-w-md mx-auto w-full space-y-6">
            <div className="text-center space-y-2 mb-4">
               <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center text-blue-600 mx-auto shadow-sm">
                  <Brain size={32} />
               </div>
               <p className="text-blue-700 font-bold">Tư duy hệ thống qua sơ đồ thông minh</p>
            </div>
            
            <div className="space-y-4">
               <select 
                  value={grade}
                  onChange={(e) => setGrade(e.target.value)}
                  className="w-full bg-white border-2 border-blue-100 rounded-2xl px-6 py-4 outline-none focus:border-blue-500 font-bold text-blue-900"
               >
                  <option value="">Chọn khối lớp...</option>
                  <option value="6">Khối 6</option>
                  <option value="7">Khối 7</option>
                  <option value="8">Khối 8</option>
                  <option value="9">Khối 9</option>
               </select>
               <input 
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="Nhập bài học/chủ đề..."
                  className="w-full bg-white border-2 border-blue-100 rounded-2xl px-6 py-4 outline-none focus:border-blue-500 font-bold text-blue-900"
               />
               <button 
                  onClick={createMindmap}
                  disabled={!topic.trim() || !grade}
                  className="w-full bg-blue-600 text-white font-black py-5 rounded-2xl shadow-xl shadow-blue-200 hover:bg-blue-700 transition-all disabled:opacity-50"
               >
                  TẠO SƠ ĐỒ
               </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto pr-4 custom-scrollbar">
             <div className="bg-white rounded-[2.5rem] p-10 border border-blue-50 shadow-sm">
                <MindmapView nodes={mindmapNodes} />
             </div>
          </div>
        )}
      </div>
    );
  }

  if (mode === "history") {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setMode("menu")}
              className="p-2 hover:bg-sky-50 rounded-xl text-sky-600 transition-all border border-sky-100"
            >
              <ArrowLeft size={20} />
            </button>
            <h3 className="font-display font-black text-sky-900 text-xl tracking-tight">Lịch sử bài tập</h3>
          </div>
          <div className="bg-sky-50 px-4 py-1.5 rounded-full border border-sky-100 flex items-center gap-2">
             <Trophy size={14} className="text-sky-600" />
             <span className="text-[10px] font-black text-sky-900 uppercase tracking-widest">{history.length} Thử thách</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-4">
          {history.length > 0 ? history.map((record) => (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              key={record.id} 
              className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex items-center gap-6 group hover:border-sky-200 transition-all"
            >
              <div className="w-14 h-14 bg-sky-50 rounded-2xl flex items-center justify-center text-sky-600 group-hover:bg-sky-600 group-hover:text-white transition-all shadow-inner">
                <Clock size={24} />
              </div>
              <div className="flex-1">
                <h4 className="font-black text-sky-900 text-lg uppercase tracking-tight">{record.topic}</h4>
                <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">
                  {record.createdAt?.toDate().toLocaleDateString('vi-VN', { 
                    day: '2-digit', 
                    month: '2-digit', 
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-display font-black text-sky-600">{record.score}<span className="text-black text-opacity-30 mx-1">/</span>{record.total}</p>
                <p className={cn(
                  "text-[10px] font-black uppercase tracking-[0.2em]",
                  (record.score / record.total) >= 0.8 ? "text-orange-500" : "text-sky-500"
                )}>
                  {(record.score / record.total) >= 0.8 ? "Xuất sắc" : "Hoàn thành"}
                </p>
              </div>
            </motion.div>
          )) : (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-4 opacity-50">
              <History size={64} />
              <p className="font-bold italic">Em chưa làm bài trắc nghiệm nào cả.</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-sky-600 gap-4 h-full">
        <Loader2 className="animate-spin" size={48} />
        <p className="font-bold text-lg font-display uppercase tracking-widest animate-pulse">Cô đang soạn bộ câu hỏi cho em...</p>
      </div>
    );
  }

  if (isFinished) {
    return (
      <div className="flex flex-col items-center justify-center py-10 h-full text-center px-4 overflow-y-auto custom-scrollbar">
         <div className="w-24 h-24 bg-orange-50 mx-auto rounded-3xl flex items-center justify-center text-orange-500 mb-6 border border-orange-100 shadow-sm shrink-0">
            <Trophy size={48} />
         </div>
         <h2 className="text-3xl font-display font-black text-sky-900 mb-2 shrink-0">Chúc mừng em!</h2>
         <p className="text-black mb-8 font-bold italic shrink-0">Em đã hoàn thành thử thách ôn tập chủ đề **{topic}**</p>
         
         <div className="grid grid-cols-2 gap-4 w-full max-w-md mb-8 shrink-0">
            <div className="bg-white p-6 rounded-3xl border border-sky-50 shadow-sm relative overflow-hidden">
               <div className="absolute top-0 left-0 w-1 h-full bg-sky-500" />
               <p className="text-[10px] font-bold text-black uppercase tracking-widest mb-1 text-left">Tiềm năng</p>
               <p className="text-3xl font-display font-black text-sky-900 text-left">+{score * 10}<span className="text-sm ml-1">XP</span></p>
            </div>
            <div className="bg-white p-6 rounded-3xl border border-sky-50 shadow-sm relative overflow-hidden">
               <div className="absolute top-0 left-0 w-1 h-full bg-orange-500" />
               <p className="text-[10px] font-bold text-black uppercase tracking-widest mb-1 text-left">Chính xác</p>
               <p className="text-3xl font-display font-black text-orange-900 text-left">{Math.round((score/quizzes.length)*100)}%</p>
            </div>
         </div>

         {loadingReport ? (
           <div className="w-full max-w-md p-10 bg-slate-50 rounded-[2rem] border border-dashed border-slate-200 mb-8 flex flex-col items-center gap-4">
              <Loader2 className="animate-spin text-sky-600" size={32} />
              <p className="text-sm font-bold text-black italic">AI đang phân tích bài làm của em...</p>
           </div>
         ) : performanceReport && (
           <motion.div 
             initial={{ opacity: 0, scale: 0.95 }}
             animate={{ opacity: 1, scale: 1 }}
             className="w-full max-w-2xl bg-sky-900 text-white rounded-[2.5rem] p-10 mb-8 relative overflow-hidden text-left"
           >
              <Sparkles className="absolute top-4 right-4 text-orange-300 opacity-20" size={48} />
              <div className="relative z-10">
                 <div className="flex items-center gap-3 mb-6">
                    <Sparkles className="text-orange-300" size={20} />
                    <h4 className="text-lg font-display font-black uppercase tracking-tight">AI PHÂN TÍCH TIẾN TRÌNH</h4>
                 </div>
                 <div className="space-y-6">
                    <div>
                       <p className="text-[10px] font-black uppercase tracking-widest text-sky-300 mb-2">Chấm điểm chi tiết:</p>
                       <p className="text-4xl font-display font-black text-orange-400">{performanceReport.score}<span className="text-xl text-white/50 ml-2">/10</span></p>
                    </div>
                    <div>
                       <p className="text-[10px] font-black uppercase tracking-widest text-sky-300 mb-2">Phân tích lỗ hổng kiến thức:</p>
                       <p className="text-sm font-medium italic leading-relaxed">"{performanceReport.analysis}"</p>
                    </div>
                    <div className="pt-6 border-t border-white/10">
                       <p className="text-[10px] font-black uppercase tracking-widest text-sky-300 mb-2">Lời khuyên từ cô Trang:</p>
                       <p className="text-sm font-bold text-white/90 leading-relaxed">{performanceReport.advice}</p>
                    </div>
                 </div>
              </div>
           </motion.div>
         )}

         <div className="flex flex-col gap-3 w-full max-w-md shrink-0">
            <button 
              onClick={startQuiz}
              className="w-full bg-sky-600 text-white font-bold py-4 rounded-2xl shadow-lg shadow-sky-200/50 hover:bg-sky-700 transition-all flex items-center justify-center gap-2"
            >
              Làm lại với thử thách khác
              <RefreshCw size={18} />
            </button>
            <div className="flex gap-3">
              <button 
                onClick={() => setMode("menu")}
                className="flex-1 bg-white text-slate-600 font-bold py-4 rounded-2xl border border-slate-200 hover:bg-slate-50 transition-all"
              >
                Quay về menu
              </button>
              <button 
                onClick={() => setMode("chat")}
                className="flex-1 bg-orange-500 text-white font-bold py-4 rounded-2xl shadow-lg shadow-orange-200/50 hover:bg-orange-600 transition-all text-xs"
              >
                Hỏi Trợ lý học tập
              </button>
            </div>
         </div>
      </div>
    );
  }

  if (mode === "menu") {
    return (
      <div className="max-w-6xl mx-auto h-full flex flex-col justify-center py-6">
        {errorMsg && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8 p-4 bg-red-50 border border-red-100 text-red-600 rounded-2xl text-center text-sm font-bold"
          >
            {errorMsg}
          </motion.div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 px-4">
           {/* Option 1: AI Quiz */}
           <motion.div 
             whileHover={{ y: -8 }}
             className="bg-gradient-to-br from-sky-100 to-white p-6 md:p-8 rounded-[3rem] border-2 border-sky-200 shadow-xl shadow-sky-900/10 flex flex-col relative overflow-hidden group"
           >
              <div className="absolute top-0 right-0 p-6 opacity-0 group-hover:opacity-10 transition-opacity">
                 <RefreshCw size={120} className="text-sky-600" />
              </div>
              <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center text-sky-600 mb-6 shadow-sm border border-sky-100 relative z-10">
                 <Zap size={28} />
              </div>
              <h3 className="font-display font-black text-lg md:text-xl lg:text-lg xl:text-xl text-sky-900 uppercase mb-3 relative z-10 tracking-tight leading-none">Chinh phục tri thức</h3>
              <p className="text-[11px] text-black mb-8 leading-relaxed font-bold relative z-10">Tạo bài tập tùy chỉnh (Trắc nghiệm/Tự luận) theo đúng yêu cầu từ tài liệu của cô Trang.</p>
              
              <div className="space-y-4 mb-8">
                <div className="grid grid-cols-2 gap-3">
                  <select 
                    value={grade}
                    onChange={(e) => setGrade(e.target.value)}
                    className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-3 outline-none focus:border-sky-500 transition-all font-bold text-sky-900 text-xs appearance-none"
                  >
                     <option value="">Khối lớp...</option>
                     <option value="6">Khối 6</option>
                     <option value="7">Khối 7</option>
                     <option value="8">Khối 8</option>
                     <option value="9">Khối 9</option>
                  </select>
                  <select 
                    value={quizType}
                    onChange={(e) => setQuizType(e.target.value)}
                    className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-3 outline-none focus:border-sky-500 transition-all font-bold text-sky-900 text-xs appearance-none"
                  >
                     <option value="Trắc nghiệm">Trắc nghiệm</option>
                     <option value="Tự luận">Tự luận</option>
                     <option value="Trắc nghiệm & Tự luận">Trắc nghiệm & Tự luận</option>
                  </select>
                </div>

                <div className="flex gap-3">
                  <input 
                    type="text" 
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="Chủ đề ôn tập..."
                    className="flex-1 bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-3 outline-none focus:border-sky-500 transition-all font-bold text-sky-900 text-xs"
                  />
                  <input 
                    type="number" 
                    max={20}
                    min={1}
                    value={quizCount || ""}
                    onChange={(e) => setQuizCount(Math.min(20, parseInt(e.target.value) || 0))}
                    placeholder="Số câu (Max 20)"
                    className="w-24 bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-3 outline-none focus:border-sky-500 transition-all font-bold text-sky-900 text-xs"
                  />
                </div>
              </div>

              <button 
                onClick={startQuiz}
                disabled={!topic.trim() || !grade || !quizCount}
                className="w-full mt-auto bg-sky-600 text-white font-black py-4 rounded-2xl shadow-lg shadow-sky-200 hover:bg-sky-700 disabled:opacity-50 transition-all text-xs uppercase tracking-widest active:scale-95"
              >
                BẮT ĐẦU THỬ THÁCH
              </button>
           </motion.div>

           {/* Option 2: Flashcards */}
           <motion.div 
             whileHover={{ y: -8 }}
             onClick={() => setMode("flashcard")}
             className="bg-gradient-to-br from-orange-100 to-white p-6 md:p-8 rounded-[3rem] border-2 border-orange-200 shadow-xl shadow-orange-900/10 flex flex-col relative overflow-hidden group cursor-pointer"
           >
              <div className="absolute top-0 right-0 p-6 opacity-0 group-hover:opacity-10 transition-opacity">
                 <Layers size={120} className="text-orange-600" />
              </div>
              <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center text-orange-500 mb-6 shadow-sm border border-orange-100 relative z-10">
                 <Layers size={28} />
              </div>
              <h3 className="font-display font-black text-lg md:text-xl lg:text-lg xl:text-xl text-orange-900 uppercase mb-3 relative z-10 tracking-tight leading-none">Flashcard</h3>
              <p className="text-[11px] text-slate-600 mb-8 leading-relaxed font-medium relative z-10">Flashcards thông minh giúp em ghi nhớ các thuật ngữ KHTN nhanh hơn.</p>
              
              <div className="mt-auto">
                <button className="w-full bg-orange-500 text-white font-black py-4 rounded-2xl shadow-lg shadow-orange-100 hover:bg-orange-600 transition-all text-xs uppercase tracking-widest">
                   MỞ THẺ
                </button>
              </div>
           </motion.div>

           {/* Option 3: Mindmap */}
           <motion.div 
             whileHover={{ y: -8 }}
             onClick={() => setMode("mindmap")}
             className="bg-gradient-to-br from-indigo-100 to-white p-6 md:p-8 rounded-[3rem] border-2 border-indigo-200 shadow-xl shadow-indigo-900/10 flex flex-col relative overflow-hidden group cursor-pointer"
           >
              <div className="absolute top-0 right-0 p-6 opacity-0 group-hover:opacity-10 transition-opacity">
                 <Brain size={120} className="text-indigo-600" />
              </div>
              <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center text-indigo-500 mb-6 shadow-sm border border-indigo-100 relative z-10">
                 <Brain size={28} />
              </div>
              <h3 className="font-display font-black text-lg md:text-xl lg:text-lg xl:text-xl text-indigo-900 uppercase mb-3 relative z-10 tracking-tight leading-none">Mindmap</h3>
              <p className="text-[11px] text-slate-600 mb-8 leading-relaxed font-medium relative z-10">Hệ thống lại kiến thức bằng sơ đồ trực quan, dễ hiểu và bao quát.</p>
              
              <div className="mt-auto relative z-10">
                <button className="w-full bg-indigo-600 text-white font-black py-4 rounded-2xl shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all text-xs uppercase tracking-widest">
                   VẼ SƠ ĐỒ
                </button>
              </div>
           </motion.div>
        </div>
      </div>
    );
  }

  const current = quizzes[currentIdx];
  const isMultipleChoice = current?.options && current.options.length > 0;

  return (
    <div className="max-w-2xl mx-auto h-full flex flex-col custom-scrollbar">
      <div className="flex items-center justify-between mb-8 bg-white p-5 rounded-[1.5rem] border border-sky-50 shadow-sm">
         <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-sky-600 rounded-2xl flex items-center justify-center text-white font-black shadow-lg">
               {currentIdx + 1}
            </div>
            <div>
               <p className="text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em] leading-none mb-1.5 focus:outline-none">Tiến trình em học</p>
               <p className="text-base font-black text-sky-900 leading-none">{currentIdx + 1} / {quizzes.length}</p>
            </div>
         </div>
         <div className="text-right flex items-center gap-6">
            <div className={cn(
              "flex flex-col items-end transition-colors",
              timeLeft <= 10 ? "text-red-500" : "text-sky-600"
            )}>
               <p className="text-[10px] font-bold uppercase tracking-[0.2em] leading-none mb-1.5 opacity-40">Thời gian</p>
               <div className="flex items-center gap-2">
                  <Clock size={16} className={timeLeft <= 10 ? "animate-pulse" : ""} />
                  <p className="text-base font-black leading-none">{timeLeft}s</p>
               </div>
            </div>
            <div>
               <p className="text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em] leading-none mb-1.5 ">Phần thưởng</p>
               <p className="text-base font-black text-orange-600 leading-none">+{score * 10} XP</p>
            </div>
         </div>
      </div>

      {/* Thanh tiến trình thời gian */}
      {!isAnswered && (
        <div className="w-full h-1.5 bg-slate-100 rounded-full mb-8 overflow-hidden shadow-inner">
           <motion.div 
             initial={{ width: "100%" }}
             animate={{ width: `${(timeLeft / 45) * 100}%` }}
             className={cn(
               "h-full transition-colors duration-1000",
               timeLeft <= 10 ? "bg-red-500" : "bg-sky-500"
             )}
           />
        </div>
      )}

      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-8">
        <motion.div 
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="bg-white rounded-[2.5rem] p-10 border border-sky-50 shadow-sm relative overflow-hidden"
        >
           <div className="text-2xl font-display font-black text-sky-900 mb-12 leading-tight tracking-tight">
             <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
               {processLaTeX(current.question)}
             </ReactMarkdown>
           </div>
           
           <AnimatePresence>
              {showHint && !isAnswered && (
                <motion.div 
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="mb-8 p-6 bg-orange-50 border-2 border-orange-200 rounded-3xl relative overflow-hidden"
                >
                   <Sparkles className="absolute top-2 right-2 text-orange-500 opacity-20" size={40} />
                   <div className="flex flex-col md:flex-row gap-6 items-center">
                      <div className="flex-1">
                         <div className="flex items-center gap-2 mb-2">
                            <AlertCircle className="text-orange-600" size={16} />
                            <p className="text-[9px] font-black text-orange-800 uppercase tracking-widest leading-none">Quy tắc Gợi ý thông minh</p>
                         </div>
                         <p className="text-xs text-orange-900 font-bold leading-relaxed mb-1 italic">"{current.hint || "Hãy xem lại câu hỏi kỹ hơn nhé!"}"</p>
                      </div>
                      <button 
                        onClick={() => setShowHint(false)}
                        className="px-6 py-3 bg-orange-500 text-white rounded-xl font-black shadow-lg shadow-orange-200 hover:bg-orange-600 transition-all uppercase tracking-widest text-[9px] shrink-0"
                      >
                        Thử lại
                      </button>
                   </div>
                </motion.div>
              )}
           </AnimatePresence>

           {isMultipleChoice ? (
             <div className="space-y-4">
                {current.options!.map((option, idx) => (
                  <motion.button
                    key={idx}
                    onClick={() => handleAnswer(idx)}
                    whileHover={!isAnswered ? { scale: 1.01, x: 5 } : {}}
                    whileTap={!isAnswered ? { scale: 0.99 } : {}}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.1 }}
                    className={cn(
                      "w-full p-6 rounded-[1.5rem] flex items-center gap-6 border-2 transition-all text-left font-bold text-sm relative group",
                      selectedIdx === idx 
                        ? (idx === current.answerIndex 
                            ? "bg-sky-50 border-sky-500 text-sky-700 shadow-lg shadow-sky-100 ring-4 ring-sky-50/50" 
                            : "bg-red-50 border-red-500 text-red-700 shadow-lg shadow-red-100 ring-4 ring-red-50/50")
                        : (isAnswered && idx === current.answerIndex 
                            ? "bg-sky-50 border-sky-500 text-sky-700 shadow-md animate-pulse" 
                            : "bg-white border-slate-100 text-slate-600 hover:border-sky-200 hover:bg-sky-50/10")
                    )}
                    disabled={isAnswered}
                  >
                    <div className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 font-display font-black text-sm border shadow-sm transition-all duration-300",
                      selectedIdx === idx 
                        ? (idx === current.answerIndex ? "bg-sky-500 text-white border-sky-400 rotate-[360deg]" : "bg-red-500 text-white border-red-400")
                        : (isAnswered && idx === current.answerIndex ? "bg-sky-500 text-white border-sky-400" : "bg-white text-sky-600 border-sky-100 group-hover:bg-sky-50 shadow-inner")
                    )}>
                      {String.fromCharCode(65 + idx)}
                    </div>
                    <span className="flex-1 leading-relaxed">
                      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                        {processLaTeX(option)}
                      </ReactMarkdown>
                    </span>
                    <AnimatePresence>
                      {isAnswered && idx === current.answerIndex && (
                        <motion.div 
                          initial={{ scale: 0, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0, opacity: 0 }}
                        >
                          <CheckCircle2 size={28} className="text-sky-500 shrink-0" />
                        </motion.div>
                      )}
                      {isAnswered && selectedIdx === idx && idx !== current.answerIndex && (
                        <motion.div
                          initial={{ scale: 0, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0, opacity: 0 }}
                        >
                          <XCircle size={28} className="text-red-500 shrink-0" />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.button>
                ))}
             </div>
           ) : (
             <div className="space-y-6">
                <div className="relative">
                  <textarea 
                    value={essayAnswer}
                    onChange={(e) => setEssayAnswer(e.target.value)}
                    disabled={isAnswered}
                    placeholder="Nhập câu trả lời của em tại đây (hoặc đính kèm ảnh bài làm)..."
                    className="w-full h-48 bg-slate-50 border-2 border-slate-100 rounded-3xl p-8 outline-none focus:border-sky-500 focus:bg-white transition-all font-medium text-lg leading-relaxed disabled:opacity-50"
                  />
                  
                  {essayImage && (
                    <div className="absolute bottom-4 left-4 w-20 h-20 rounded-xl overflow-hidden shadow-md border-2 border-white">
                      <img src={`data:${essayImage.mimeType};base64,${essayImage.data}`} className="w-full h-full object-cover" />
                      {!isAnswered && (
                        <button 
                          onClick={() => setEssayImage(null)} 
                          className="absolute top-1 right-1 bg-white rounded-full text-red-500 shadow-sm hover:scale-110 transition-transform"
                        >
                          <XCircle size={14} />
                        </button>
                      )}
                    </div>
                  )}

                  {!isAnswered && (
                    <button 
                      onClick={() => imageInputRef.current?.click()}
                      className="absolute bottom-4 right-4 p-3 bg-sky-100 text-sky-600 rounded-xl hover:bg-sky-200 transition-colors shadow-sm cursor-pointer"
                      title="Đính kèm ảnh"
                    >
                      <ImageIcon size={20} />
                    </button>
                  )}
                  <input 
                    type="file" 
                    ref={imageInputRef} 
                    className="hidden" 
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onloadend = () => {
                          const base64String = (reader.result as string).split(',')[1];
                          setEssayImage({ data: base64String, mimeType: file.type });
                        };
                        reader.readAsDataURL(file);
                      }
                      e.target.value = '';
                    }}
                  />
                </div>
                {!isAnswered && (
                  <button 
                    onClick={submitEssay}
                    disabled={(!essayAnswer.trim() && !essayImage) || isGrading}
                    className="w-full bg-sky-600 text-white font-black py-5 rounded-2xl hover:bg-sky-700 transition-all shadow-xl shadow-sky-200/50 flex items-center justify-center gap-3 active:scale-[0.98] uppercase tracking-widest text-[11px]"
                  >
                     {isGrading ? <Loader2 className="animate-spin" /> : "Gửi câu trả lời"}
                  </button>
                )}
             </div>
           )}

           <AnimatePresence>
             {isAnswered && (
               <motion.div 
                 initial={{ opacity: 0, height: 0 }}
                 animate={{ opacity: 1, height: "auto" }}
                 className="mt-12 overflow-hidden"
               >
                  <div className="p-8 bg-sky-50/50 rounded-[2rem] border border-sky-100 relative shadow-inner">
                    <div className="flex items-center gap-3 mb-4 text-sky-800 font-black uppercase tracking-[0.2em] text-[10px]">
                       <div className="w-6 h-6 bg-sky-200 rounded-full flex items-center justify-center">
                         <HelpCircle size={14} className="text-sky-700" />
                       </div>
                       Gia sư AI chấm điểm & giải thích
                    </div>
                    <div className="prose prose-slate prose-sm max-w-none markdown-body">
                      {essayFeedback ? (
                        <>
                          <div className="text-sky-900 leading-relaxed font-semibold italic opacity-90">
                            <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{processLaTeX(essayFeedback.feedback)}</ReactMarkdown>
                          </div>
                          <div className={cn("mt-4 inline-block px-4 py-1.5 rounded-full font-bold", essayFeedback.isPassing ? "bg-sky-100 text-sky-700" : "bg-red-100 text-red-700")}>
                            {essayFeedback.isPassing ? `Đạt Yêu Cầu (${essayFeedback.score}/10)` : `Cần Cố Gắng Hơn (${essayFeedback.score}/10)`}
                          </div>
                        </>
                      ) : (
                        <div className="text-sky-900 leading-relaxed font-semibold italic opacity-90">
                            <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{processLaTeX(current.explanation)}</ReactMarkdown>
                        </div>
                      )}
                    </div>
                    
                    <button 
                      onClick={nextQuestion}
                      className="w-full mt-10 bg-sky-600 text-white font-black py-5 rounded-2xl hover:bg-sky-700 transition-all shadow-xl shadow-sky-200/50 flex items-center justify-center gap-3 active:scale-[0.98] uppercase tracking-widest text-[11px]"
                    >
                      {currentIdx < quizzes.length - 1 ? "Tiếp tục thử thách" : "Hoàn thành & Nhận XP"}
                      <ChevronRight size={20} />
                    </button>
                  </div>
               </motion.div>
             )}
           </AnimatePresence>
        </motion.div>
      </div>
    </div>
  );
}

function FlashcardItem({ card }: { card: Flashcard }) {
  const [flipped, setFlipped] = useState(false);

  return (
    <div 
      className="w-full h-full cursor-pointer perspective-1000"
      onClick={() => setFlipped(!flipped)}
    >
      <motion.div
        animate={{ 
          rotateY: flipped ? 180 : 0,
          z: flipped ? 50 : 0
        }}
        transition={{ duration: 0.6, type: "spring", stiffness: 200, damping: 20 }}
        whileHover={{ scale: 1.02, rotateX: 2, rotateY: flipped ? 178 : 2 }}
        whileTap={{ scale: 0.98 }}
        className="w-full h-full relative preserve-3d"
      >
        {/* Front */}
        <div 
          className="absolute inset-0 backface-hidden bg-gradient-to-br from-white to-orange-50 border-4 border-orange-100 rounded-[2.5rem] p-10 flex flex-col items-center justify-center text-center shadow-xl group-hover:border-orange-300 transition-all duration-500"
        >
           <div className="absolute top-4 right-4 opacity-10">
              <Sparkles size={40} className="text-orange-400" />
           </div>
           <p className="text-[10px] font-black text-orange-400 uppercase tracking-widest mb-6">MẶT TRƯỚC</p>
           <div className="text-2xl font-display font-black text-orange-900 leading-tight">
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{processLaTeX(card.front)}</ReactMarkdown>
           </div>
           <div className="mt-12 group-hover:scale-110 transition-transform">
              <div className="bg-orange-100/50 px-4 py-2 rounded-full text-orange-600 font-bold italic text-[10px]">Chạm để xem đáp án...</div>
           </div>
        </div>

        {/* Back */}
        <div 
          className="absolute inset-0 backface-hidden bg-gradient-to-br from-orange-600 to-orange-500 border-4 border-orange-400 rounded-[2.5rem] p-10 flex flex-col items-center justify-center text-center shadow-2xl text-white shadow-orange-200/20"
          style={{ transform: "rotateY(180deg)" }}
        >
           <div className="absolute top-4 left-4 opacity-20">
              <Zap size={40} className="text-white" />
           </div>
           <p className="text-[10px] font-black text-white/50 uppercase tracking-widest mb-6">MẶT SAU</p>
           <div className="text-xl font-bold leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{processLaTeX(card.back)}</ReactMarkdown>
           </div>
        </div>
      </motion.div>
    </div>
  );
}

function MindmapView({ nodes }: { nodes: MindmapNode[] }) {
  const root = nodes.find(n => !n.parentId);
  if (!root) return null;

  const getDepthColors = (depth: number) => {
    switch (depth) {
      case 0: return { bg: "bg-indigo-600", text: "text-white", border: "border-indigo-400", dot: "bg-indigo-300", line: "border-indigo-200" };
      case 1: return { bg: "bg-sky-50", text: "text-sky-900", border: "border-sky-200", dot: "bg-sky-500", line: "border-sky-100" };
      case 2: return { bg: "bg-teal-50", text: "text-teal-900", border: "border-teal-200", dot: "bg-teal-500", line: "border-teal-100" };
      case 3: return { bg: "bg-orange-50", text: "text-orange-900", border: "border-orange-200", dot: "bg-orange-500", line: "border-orange-100" };
      default: return { bg: "bg-slate-50", text: "text-slate-900", border: "border-slate-200", dot: "bg-slate-500", line: "border-slate-100" };
    }
  };

  const renderNodes = (parentId: string, depth = 0) => {
    const children = nodes.filter(n => n.parentId === parentId);
    if (children.length === 0) return null;
    
    const colors = getDepthColors(depth + 1);
    const parentColors = getDepthColors(depth);

    return (
      <div className={cn("space-y-4 relative", depth > 0 && `ml-6 md:ml-12 border-l-4 ${parentColors.line} pl-6 md:pl-10 mt-6`)}>
        {children.map((node, idx) => (
          <motion.div 
            initial={{ opacity: 0, x: -20, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            transition={{ delay: idx * 0.1, type: "spring", stiffness: 200 }}
            key={node.id} 
            className="relative"
          >
            {/* Horizontal connection line to the node */}
            {depth > 0 && (
               <div className={`absolute -left-6 md:-left-10 top-1/2 w-6 md:w-10 border-t-4 ${parentColors.line} -translate-y-1/2`} />
            )}
            
            <div className={cn(
               "p-4 md:p-5 rounded-3xl border-2 shadow-lg hover:shadow-xl transition-all flex items-center gap-3 md:gap-4 relative z-10",
               colors.bg, colors.border
            )}>
               <div className={cn("w-3 h-3 rounded-full shrink-0 shadow-inner", colors.dot)} />
               <div className={cn("font-bold text-sm md:text-base leading-snug", colors.text)}>
                  <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{processLaTeX(node.label)}</ReactMarkdown>
               </div>
            </div>
            {renderNodes(node.id, depth + 1)}
          </motion.div>
        ))}
      </div>
    );
  };

  const rootColors = getDepthColors(0);

  return (
    <div className="py-8 overflow-x-auto custom-scrollbar">
       <div className="min-w-[300px] md:min-w-[600px] pb-10 px-4">
         <motion.div 
           initial={{ scale: 0.8, opacity: 0 }}
           animate={{ scale: 1, opacity: 1 }}
           className={cn(
              "px-8 py-6 rounded-[2rem] font-display font-black text-center text-xl md:text-2xl shadow-2xl border-4 mb-4 max-w-sm relative z-10",
              rootColors.bg, rootColors.text, rootColors.border
           )}
         >
            <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{processLaTeX(root.label)}</ReactMarkdown>
         </motion.div>
         {renderNodes(root.id)}
       </div>
    </div>
  );
}
