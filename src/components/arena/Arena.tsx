import { useState, useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { Trophy, Users, Sword, ChevronRight, User as UserIcon, Zap, Loader2, Timer, CheckCircle2, XCircle, Medal, Bot, LayoutGrid, List, Shield, Sparkles, AlertCircle, BookOpen, RefreshCw } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn, getRank, RANKS } from "../../lib/utils";
import { generateQuiz, analyzePerformance } from "../../lib/gemini";
import { db, handleFirestoreError } from "../../lib/firebase";
import { collection, getDocs, addDoc, query, orderBy, limit, serverTimestamp, where } from "firebase/firestore";
import confetti from "canvas-confetti";

let socket: Socket;

export default function Arena({ studentName, addXP, totalXP }: { studentName: string; addXP: (xp: number) => void; totalXP: number }) {
  const [players, setPlayers] = useState<any[]>([]);
  const [status, setStatus] = useState<"lobby" | "matching" | "battle" | "result" | "ai-config">("lobby");
  const [view, setView] = useState<"main" | "leaderboard">("main");
  const [isAiMode, setIsAiMode] = useState(false);
  const [battleConfig, setBattleConfig] = useState({ grade: "", topic: "", type: "Trắc nghiệm", count: 5 });
  const [battleData, setBattleData] = useState<any>(null);
  const [scores, setScores] = useState<any>({});
  const [questions, setQuestions] = useState<any[]>([]);
  const [performanceReport, setPerformanceReport] = useState<any>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [streak, setStreak] = useState(0);
  const [battleResult, setBattleResult] = useState<any>(null);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [userStats, setUserStats] = useState({ wins: 0, total: 0 });
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    socket = io();

    socket.on("connect", () => {
      socket.emit("join-lobby", studentName);
    });

    socket.on("players-update", (data) => setPlayers(data));
    
    socket.on("match-found", async (data) => {
      setupBattle(data, false);
    });

    socket.on("battle-update", (data) => {
      setScores(data.scores);
    });

    socket.on("battle-finished", (data) => {
      handleBattleFinish(data);
    });

    fetchLeaderboard();
    return () => {
      socket.disconnect();
    };
  }, [studentName]);

  const fetchLeaderboard = async () => {
    try {
      const q = query(collection(db, "arena_results"), orderBy("score", "desc"), limit(10));
      const snap = await getDocs(q);
      setLeaderboard(snap.docs.map(d => ({ id: d.id, ...d.data() })));

      // Fetch user specific stats
      const userQ = query(collection(db, "arena_results"), where("username", "==", studentName));
      const userSnap = await getDocs(userQ);
      const wins = userSnap.docs.filter(d => d.data().winner).length;
      setUserStats({ wins, total: userSnap.size });
    } catch (e) {
      console.error(e);
    }
  };

  const setupBattle = async (data: any, aiMode: boolean) => {
    setIsAiMode(aiMode);
    setBattleData(data);
    try {
      setStatus("matching"); // Show loading during generation
      const kbSnap = await getDocs(query(collection(db, "knowledge_base"), limit(20)));
      const context = kbSnap.docs.map(d => d.data().content).join("\n\n");
      const quizData = await generateQuiz("KHTN THCS (Vật lý, Hóa học, Sinh học)", context);
      setQuestions(quizData.quizzes || []);
      setStatus("battle");
      setScores({ [socket.id]: 0, [data.opponent.id]: 0 });
    } catch (err) {
      setStatus("lobby");
    }
  };

  const startAiMatch = () => {
    setIsAiMode(true);
    setStatus("ai-config");
  };

  const confirmAiBattle = async () => {
    if (!battleConfig.topic.trim() || !battleConfig.grade) return;
    
    const aiOpponent = {
      id: "ai-tutor",
      username: "Gia sư AI (Thử thách)",
      isAi: true
    };
    
    setStatus("matching");
    setErrorMsg("");
    setBattleData({ battleId: `ai-${Date.now()}`, opponent: aiOpponent });
    
    try {
      // Get context based on topic
      const knowledgeRef = collection(db, "knowledge_base");
      const snap = await getDocs(knowledgeRef);
      const chunks = snap.docs.map(d => d.data().content as string);
      const keywords = battleConfig.topic.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      
      const context = chunks
        .map(content => {
          let score = 0;
          const lowContent = content.toLowerCase();
          keywords.forEach(word => { if (lowContent.includes(word)) score++; });
          return { content, score };
        })
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .map(item => item.content)
        .join("\n\n---\n\n");

      const quizData = await generateQuiz(battleConfig.topic, context, battleConfig.grade, battleConfig.type, battleConfig.count);
      
      if (quizData.error) {
        setErrorMsg(quizData.error);
        setStatus("ai-config");
      } else {
        setQuestions(quizData.quizzes || []);
        setScores({ [socket.id]: 0, [aiOpponent.id]: 0 });
        setStatus("battle");
      }
    } catch (err) {
      console.error(err);
      setErrorMsg("❗ Không thể khởi tạo trận đấu. Vui lòng thử lại.");
      setStatus("ai-config");
    }
  };

  const handleBattleFinish = async (result: any) => {
    setBattleResult(result);
    setLoadingReport(true);
    setStatus("result");
    
    const myScore = result.scores[socket.id];
    const oppId = Object.keys(result.scores).find(id => id !== socket.id);
    const oppScore = oppId ? result.scores[oppId] : 0;
    const winner = myScore >= oppScore;

    // AI Analysis if in AI mode
    if (isAiMode) {
      try {
        const report = await analyzePerformance(battleConfig.topic, result.results.map((res: boolean, i: number) => ({
          question: questions[i].question,
          correct: res
        })), "Tài liệu học tập về " + battleConfig.topic);
        setPerformanceReport(report);
      } catch (e) {
        console.error("AI Analysis Error:", e);
      }
    }

    let xpEarned = isAiMode ? 50 : 20; // Completion
    if (winner) xpEarned += isAiMode ? 50 : 30;
    if (streak >= 10) xpEarned += 100;
    
    addXP(xpEarned);
    if (winner) confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });

    // Save to Firestore
    try {
      await addDoc(collection(db, "arena_results"), {
        username: studentName,
        score: myScore,
        winner,
        opponent: battleData.opponent.username,
        xpEarned,
        createdAt: serverTimestamp(),
        mode: isAiMode ? "AI" : "PvP"
      });
      fetchLeaderboard();
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingReport(false);
    }
  };

  const findMatch = () => {
    setStatus("matching");
    socket.emit("find-match");
  };

  const cancelMatch = () => {
    setStatus("lobby");
    socket.emit("cancel-match");
  };

  if (status === "ai-config") {
    return (
      <div className="max-w-4xl mx-auto h-[70vh] flex flex-col justify-center">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white p-10 md:p-16 rounded-[3.5rem] border-4 border-orange-100 shadow-2xl relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 p-12 opacity-5">
            <Bot size={180} className="text-orange-600" />
          </div>
          
          <div className="relative z-10">
            <div className="flex items-center gap-6 mb-12">
               <div className="w-16 h-16 bg-orange-600 rounded-3xl flex items-center justify-center text-white shadow-xl shadow-orange-200">
                  <Bot size={32} />
               </div>
               <div>
                  <h3 className="text-3xl font-display font-black text-orange-900 tracking-tight uppercase">CẤU HÌNH THÁCH ĐẤU</h3>
                  <p className="text-orange-800/60 font-bold text-xs uppercase tracking-widest mt-1">Sẵn sàng chưa? Hãy nhập Khối và Chủ đề em muốn đấu nhé!</p>
               </div>
            </div>

            {errorMsg && (
              <div className="mb-8 p-4 bg-red-50 border border-red-100 text-red-600 rounded-2xl text-center text-sm font-bold animate-shake">
                {errorMsg}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
               <div className="space-y-3">
                  <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">📦 Khối lớp</label>
                  <select 
                    value={battleConfig.grade}
                    onChange={(e) => setBattleConfig(prev => ({ ...prev, grade: e.target.value }))}
                    className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-5 outline-none focus:border-orange-500 focus:bg-white transition-all font-bold text-orange-900 appearance-none"
                  >
                     <option value="">Chọn khối lớp...</option>
                     <option value="6">Khối 6</option>
                     <option value="7">Khối 7</option>
                     <option value="8">Khối 8</option>
                     <option value="9">Khối 9</option>
                  </select>
               </div>
               <div className="space-y-3">
                  <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">📚 Chủ đề thách đấu</label>
                  <input 
                    type="text" 
                    value={battleConfig.topic}
                    onChange={(e) => setBattleConfig(prev => ({ ...prev, topic: e.target.value }))}
                    placeholder="Ví dụ: Quang hợp, Nguyên tử..."
                    className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-5 outline-none focus:border-orange-500 focus:bg-white transition-all font-bold text-orange-900"
                  />
               </div>
               <div className="space-y-3">
                  <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">📝 Dạng bài thách đấu</label>
                  <select 
                    value={battleConfig.type}
                    onChange={(e) => setBattleConfig(prev => ({ ...prev, type: e.target.value }))}
                    className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-5 outline-none focus:border-orange-500 transition-all font-bold text-orange-900 appearance-none"
                  >
                     <option value="Trắc nghiệm">Trắc nghiệm</option>
                     <option value="Tự luận">Tự luận</option>
                     <option value="Trắc nghiệm & Tự luận">Trắc nghiệm & Tự luận</option>
                  </select>
               </div>
               <div className="space-y-3">
                  <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">🔢 Số câu hỏi (Tối đa 20)</label>
                  <input 
                    type="number" 
                    min="1"
                    max="20"
                    value={battleConfig.count}
                    onChange={(e) => setBattleConfig(prev => ({ ...prev, count: Math.min(20, Math.max(1, parseInt(e.target.value) || 1)) }))}
                    className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-5 outline-none focus:border-orange-500 focus:bg-white transition-all font-bold text-orange-900"
                  />
               </div>

               <div className="md:col-span-2 p-5 bg-orange-50 rounded-3xl border border-orange-100">
                  <div className="flex gap-4 items-start">
                     <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center text-white shrink-0 mt-1">
                        <Zap size={20} />
                     </div>
                     <div>
                        <p className="text-[10px] font-black text-orange-800 uppercase tracking-widest mb-1">Chế độ thi:</p>
                        <p className="text-xs text-orange-900/70 font-medium leading-relaxed italic">
                           {battleConfig.type === "Trắc nghiệm" && "Thử thách phản xạ và độ chính xác: Câu hỏi nhận biết nhanh, hình ảnh/đồ thị, ứng dụng thực tế."}
                           {battleConfig.type === "Tự luận" && "Thử thách khả năng diễn đạt và hiểu sâu: Câu hỏi 'Tại sao', so sánh/phân tích, sáng tạo, giải quyết vấn đề, tính toán."}
                           {battleConfig.type === "Trắc nghiệm & Tự luận" && "Kết hợp 50% Trắc nghiệm & 50% Tự luận: Thử thách toàn diện từ tốc độ đến chiều sâu kiến thức."}
                        </p>
                     </div>
                  </div>
               </div>
            </div>

            <div className="flex flex-col md:flex-row gap-4">
              <button 
                onClick={() => setStatus("lobby")}
                className="flex-1 py-5 rounded-2xl font-black text-slate-500 hover:bg-slate-50 transition-all uppercase tracking-widest text-[11px]"
              >
                Hủy bỏ
              </button>
              <button 
                onClick={confirmAiBattle}
                disabled={!battleConfig.topic || !battleConfig.grade}
                className="flex-[2] bg-orange-600 text-white font-black py-6 rounded-[2rem] shadow-2xl shadow-orange-200 hover:bg-orange-700 disabled:opacity-50 transition-all text-sm uppercase tracking-[0.2em] transform active:scale-95"
              >
                BẮT ĐẦU
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  if (status === "matching") {
    return (
      <div className="max-w-4xl mx-auto h-[70vh] flex flex-col items-center justify-center relative px-6 text-center">
        <motion.div 
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="space-y-12"
        >
          {errorMsg ? (
            <div className="bg-red-50 border-2 border-red-100 p-12 rounded-[3.5rem] shadow-2xl relative overflow-hidden max-w-2xl mx-auto">
               <div className="absolute top-4 right-4 text-red-100">
                  <AlertCircle size={80} />
               </div>
               <div className="relative z-10">
                  <h3 className="text-2xl font-display font-black text-red-900 mb-6 uppercase tracking-tight">Rất tiếc, có chút vấn đề rồi!</h3>
                  <p className="text-red-700 font-bold text-lg mb-10 leading-relaxed italic">"{errorMsg}"</p>
                  <button 
                    onClick={() => setStatus("ai-config")}
                    className="bg-red-600 text-white px-10 py-5 rounded-2xl font-black shadow-xl shadow-red-200 hover:bg-red-700 transition-all uppercase tracking-widest text-[11px]"
                  >
                    Thử chọn chủ đề khác
                  </button>
               </div>
            </div>
          ) : (
            <>
              <div className="relative">
                 <div className="absolute inset-0 bg-sky-200 rounded-full blur-[80px] opacity-40 animate-pulse" />
                 <div className="w-40 h-40 bg-sky-600 rounded-[3rem] flex items-center justify-center text-white relative z-10 mx-auto shadow-[0_20px_50px_-15px_rgba(13,148,136,0.5)] rotate-12">
                    <Medal size={80} className="animate-bounce" />
                 </div>
              </div>
              <div className="space-y-4">
                <h3 className="text-3xl md:text-5xl font-display font-black text-sky-900 tracking-tight uppercase leading-tight max-w-4xl mx-auto px-4">
                  {isAiMode ? "Đề thi đang sẵn sàng. Chúc em may mắn!" : "Đang tìm đối thủ..."}
                </h3>
                <p className="text-slate-400 font-bold tracking-[0.3em] uppercase text-[11px]">
                  {isAiMode ? "Vui lòng đợi trong giây lát" : "Ghép cặp ngẫu nhiên tại Trường Phước Tân 3"}
                </p>
              </div>
              <div className="flex justify-center gap-2">
                 {[1,2,3].map(i => (
                    <motion.div 
                       key={i}
                       animate={{ scale: [1, 1.5, 1], opacity: [0.3, 1, 0.3] }}
                       transition={{ repeat: Infinity, duration: 1, delay: i * 0.2 }}
                       className="w-3 h-3 bg-sky-500 rounded-full"
                    />
                 ))}
              </div>
              <button 
                onClick={cancelMatch}
                className="px-10 py-4 bg-white text-slate-400 font-black rounded-2xl hover:bg-red-50 hover:text-red-500 transition-all border-2 border-slate-100 shadow-sm uppercase tracking-widest text-[10px]"
              >
                Hủy và quay về sảnh
              </button>
            </>
          )}
        </motion.div>
      </div>
    );
  }

  if (status === "battle" && questions.length > 0) {
    return (
      <ActiveBattle 
        battleId={battleData.battleId}
        opponent={battleData.opponent}
        questions={questions}
        scores={scores}
        isAiMode={isAiMode}
        totalXP={totalXP}
        onFinish={(aiResult?: any) => {
          if (isAiMode && aiResult) {
            handleBattleFinish(aiResult);
          } else {
            socket.emit("finish-battle", { battleId: battleData.battleId });
          }
        }}
      />
    );
  }

  if (status === "result" && battleResult) {
    const myScore = battleResult.scores[socket.id];
    const oppId = Object.keys(battleResult.scores).find(id => id !== socket.id);
    const oppScore = oppId ? battleResult.scores[oppId] : 0;
    const winner = myScore >= oppScore;
    const rank = getRank(totalXP);

    return (
      <div className="max-w-6xl mx-auto py-10 px-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-[3.5rem] p-8 md:p-16 border border-sky-50 shadow-2xl relative overflow-hidden"
        >
           <div className="absolute top-0 right-0 p-12 opacity-10">
              <Trophy size={200} className="text-orange-500" />
           </div>

           <div className="text-center mb-16 relative z-10">
              <div className="inline-block px-8 py-3 bg-sky-50 text-sky-600 rounded-full font-black text-xs uppercase tracking-widest border border-sky-100 mb-6">
                Kết quả trận đấu
              </div>
              <h2 className="text-4xl md:text-5xl font-display font-black text-sky-900 mb-4">
                {winner ? "CHIẾN THẮNG TUYỆT VỜI!" : "MỘT TRẬN ĐẤU CỐ GẮNG!"}
              </h2>
              <div className="flex items-center justify-center gap-4 text-slate-400 font-bold">
                 <Sword size={20} />
                 <span>Chế độ: {isAiMode ? `Thách đấu AI (${battleConfig.topic})` : "Đối kháng trực tiếp"}</span>
              </div>
           </div>

           <div className="grid grid-cols-1 md:grid-cols-2 gap-12 mb-16 relative z-10">
              <ResultCard 
                name={studentName} 
                score={myScore} 
                winner={winner} 
              />
              <ResultCard 
                name={battleData.opponent.username} 
                score={oppScore} 
                winner={!winner} 
                isOpponent
              />
           </div>

           {loadingReport ? (
             <div className="p-12 text-center bg-slate-50 rounded-[2.5rem] border border-dashed border-slate-200">
                <Loader2 className="animate-spin mx-auto mb-4 text-sky-600" size={32} />
                <p className="font-bold text-black italic">AI của cô Trang đang phân tích bài làm của em...</p>
             </div>
           ) : performanceReport && isAiMode && (
             <motion.div 
               initial={{ opacity: 0, scale: 0.95 }}
               animate={{ opacity: 1, scale: 1 }}
               className="mb-16 p-12 bg-sky-900 rounded-[3rem] text-white shadow-2xl relative overflow-hidden"
             >
                <Sparkles className="absolute top-8 right-8 text-orange-300 opacity-30" size={64} />
                <div className="relative z-10">
                   <div className="flex items-center gap-4 mb-8">
                      <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-md">
                        <Sparkles className="text-orange-300" />
                      </div>
                      <h4 className="text-2xl font-display font-black uppercase tracking-tight">AI PHÂN TÍCH KẾT QUẢ</h4>
                   </div>

                   <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                      <div className="bg-white/10 p-8 rounded-3xl backdrop-blur-md border border-white/10">
                         <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/50 mb-3">Chốt điểm</p>
                         <p className="text-6xl font-display font-black text-orange-400">{performanceReport.score}<span className="text-2xl text-white/50 ml-2">/10</span></p>
                      </div>
                      <div className="md:col-span-2 space-y-6">
                         <div>
                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/50 mb-2">Phân tích lỗ hổng kiến thức:</p>
                            <p className="text-lg font-medium leading-relaxed italic">"{performanceReport.analysis}"</p>
                         </div>
                         <div className="pt-6 border-t border-white/10 flex items-start gap-4">
                            <BookOpen className="text-orange-400 shrink-0" />
                            <div>
                               <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/50 mb-2">Lời khuyên rèn luyện từ cô Trang:</p>
                               <p className="text-sm text-white/80 leading-relaxed font-bold">{performanceReport.advice}</p>
                            </div>
                         </div>
                      </div>
                   </div>
                </div>
             </motion.div>
           )}

           <div className="flex flex-col md:flex-row gap-6 justify-center">
              <button 
                onClick={() => setStatus("lobby")}
                className="px-10 py-5 bg-sky-600 text-white rounded-2xl font-black shadow-xl shadow-sky-200 hover:bg-sky-700 transition-all flex items-center justify-center gap-3 uppercase tracking-widest text-xs"
              >
                <RefreshCw size={18} />
                Thách đấu trận mới
              </button>
              <button 
                onClick={() => setStatus("lobby")}
                className="px-10 py-5 bg-white text-slate-600 border-2 border-slate-100 rounded-2xl font-black hover:bg-slate-50 transition-all uppercase tracking-widest text-xs"
              >
                Quay về sảnh đấu
              </button>
           </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Navigation Tabs */}
      <div className="flex items-center gap-4 bg-white p-2 rounded-2xl border border-sky-100 w-fit mx-auto shadow-sm">
         <button 
           onClick={() => setView("main")}
           className={cn("px-6 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all", view === "main" ? "bg-sky-600 text-white shadow-lg" : "text-slate-500 hover:bg-sky-50")}
         >
            <Sword size={16} />
            Sảnh đấu
         </button>
         <button 
           onClick={() => setView("leaderboard")}
           className={cn("px-6 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all", view === "leaderboard" ? "bg-sky-600 text-white shadow-lg" : "text-slate-500 hover:bg-sky-50")}
         >
            <Trophy size={16} />
            Bảng xếp hạng
         </button>
      </div>

      {view === "leaderboard" ? (
        <div className="max-w-4xl mx-auto">
           <div className="bg-white rounded-[2.5rem] p-10 border border-sky-50 shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 p-10 opacity-10">
                 <Trophy size={120} className="text-sky-600" />
              </div>
              <h3 className="text-3xl font-display font-black text-sky-900 mb-2">Bảng Xếp Hạng Đấu Trường</h3>
              <p className="text-black font-bold mb-10">Top 10 chiến binh tri thức xuất sắc nhất Trường Phước Tân 3</p>

              <div className="space-y-4">
                 {leaderboard.length > 0 ? leaderboard.map((entry, idx) => (
                   <div key={entry.id} className={cn(
                     "flex items-center gap-6 p-6 rounded-[1.5rem] border transition-all",
                     idx === 0 ? "bg-orange-50 border-orange-200 shadow-orange-100 shadow-md" : (idx === 1 ? "bg-slate-50 border-slate-200" : "bg-white border-slate-100")
                   )}>
                      <div className={cn(
                        "w-12 h-12 rounded-xl flex items-center justify-center font-display font-black text-lg shadow-sm border-2",
                        idx === 0 ? "bg-orange-400 text-white border-orange-300" : (idx === 1 ? "bg-slate-300 text-white border-slate-200" : "bg-sky-50 text-sky-600 border-sky-100")
                      )}>
                         {idx + 1}
                      </div>
                      <div className="flex-1">
                         <p className="font-display font-black text-sky-900 text-lg uppercase tracking-tight">{entry.username}</p>
                         <p className="text-xs text-black font-black uppercase tracking-widest">{entry.winner ? "Bậc kỳ tài" : "Chiến binh"}</p>
                      </div>
                      <div className="text-right">
                         <p className="text-2xl font-display font-black text-sky-600">{entry.score}</p>
                         <p className="text-[10px] text-slate-400 font-bold uppercase">Điểm cao nhất</p>
                      </div>
                   </div>
                 )) : (
                   <div className="text-center py-20 text-slate-400 font-bold italic">
                      Chưa có dữ liệu xếp hạng. Hãy là người đầu tiên thách đấu!
                   </div>
                 )}
              </div>
           </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-8 space-y-6">
              <div className="bg-white rounded-[2.5rem] p-10 border border-sky-50 shadow-xl shadow-sky-900/5 overflow-hidden relative">
                <div className="absolute top-0 right-0 w-64 h-64 bg-sky-50 rounded-full -mr-32 -mt-32 opacity-50" />
                <div className="relative z-10">
                    <div className="flex items-center justify-between mb-12">
                      <div className="flex items-center gap-4">
                          <div className="w-14 h-14 bg-sky-600 rounded-2xl flex items-center justify-center text-white shadow-xl">
                            <Sword size={28} />
                          </div>
                          <div>
                            <h3 className="font-display font-black text-sky-900 text-2xl tracking-tight">Thách Đấu Tri Thức</h3>
                            <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Hệ thống thi đấu thời gian thực</p>
                          </div>
                      </div>
                      <div className="text-right hidden md:block">
                        <p className="text-sm font-black text-sky-900">{studentName}</p>
                        <div className="flex items-center gap-3 mt-1 justify-end">
                           <span className="text-[10px] font-bold text-slate-400 uppercase">TL Thắng: <span className="text-sky-600">{userStats.total > 0 ? Math.round((userStats.wins/userStats.total)*100) : 0}%</span></span>
                           <span className="text-[10px] font-bold text-slate-400 uppercase">Tổng trận: <span className="text-sky-600">{userStats.total}</span></span>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
                      <div 
                        className="bg-gradient-to-br from-sky-500 to-sky-700 rounded-[2rem] p-6 text-white shadow-2xl group cursor-pointer relative overflow-hidden h-64 flex flex-col"
                        onClick={findMatch}
                      >
                        <Users size={80} className="absolute -right-4 -bottom-4 opacity-20 group-hover:scale-110 transition-transform" />
                        <h4 className="text-xl font-display font-black mb-2">Thách đấu đôi</h4>
                        <p className="text-sky-100 text-xs mb-8 leading-relaxed font-medium">Tìm kiếm đối thủ ngẫu nhiên.</p>
                        <div className="mt-auto">
                          <button className="bg-white/20 hover:bg-white/30 backdrop-blur-md px-4 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all">Tìm trận</button>
                        </div>
                      </div>

                      <div 
                         className="bg-gradient-to-br from-purple-500 to-purple-700 rounded-[2rem] p-6 text-white shadow-2xl group cursor-pointer relative overflow-hidden h-64 flex flex-col"
                         onClick={startAiMatch}
                      >
                        <Bot size={80} className="absolute -right-4 -bottom-4 opacity-20 group-hover:scale-110 transition-transform" />
                        <h4 className="text-xl font-display font-black mb-2">Đấu với AI</h4>
                        <p className="text-purple-100 text-xs mb-8 leading-relaxed font-medium">Thử thách Gia sư AI với các câu hỏi khó.</p>
                        <div className="mt-auto">
                          <button className="bg-white/20 hover:bg-white/30 backdrop-blur-md px-4 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all">Thiết lập</button>
                        </div>
                      </div>

                      <div 
                         className="bg-gradient-to-br from-orange-500 to-orange-700 rounded-[2rem] p-6 text-white shadow-2xl relative overflow-hidden h-64 flex flex-col"
                      >
                        <Medal size={80} className="absolute -right-4 -bottom-4 opacity-20" />
                        <h4 className="text-xl font-display font-black mb-2">Bảng danh hiệu</h4>
                        <div className="bg-white/20 backdrop-blur-md rounded-2xl p-4 mt-auto">
                           <div className="flex items-center gap-3 mb-2">
                              <Shield className="text-orange-300" size={20} />
                              <div>
                                 <p className="text-[9px] font-black uppercase text-white/70">Danh hiệu hiện tại</p>
                                 <p className="font-bold text-sm text-white leading-none truncate max-w-[120px]">{getRank(totalXP).name}</p>
                              </div>
                           </div>
                           <div className="w-full bg-black/20 h-1.5 rounded-full overflow-hidden">
                              <motion.div 
                                 initial={{ width: 0 }}
                                 animate={{ width: `${Math.min(((totalXP) / (getRank(totalXP).max === Infinity ? 1 : getRank(totalXP).max)) * 100, 100)}%` }}
                                 className="h-full bg-orange-400"
                              />
                           </div>
                           <p className="text-[8px] font-black text-white/50 mt-2 uppercase tracking-widest leading-tight truncate">Đặc quyền: {getRank(totalXP).perk}</p>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                      <StatBox label="Tỉ lệ thắng" value={userStats.total > 0 ? `${Math.round((userStats.wins/userStats.total)*100)}%` : "0%"} icon={<Zap size={16} />} color="sky" />
                      <StatBox label="Danh hiệu" value={getRank(totalXP).name} icon={<Shield size={16} />} color="orange" />
                      <StatBox label="Kinh nghiệm" value={totalXP} icon={<Sparkles size={16} />} color="green" />
                    </div>
                </div>
              </div>
          </div>

          <div className="lg:col-span-4 space-y-6">
              <div className="bg-white rounded-[2rem] p-8 border border-sky-50 shadow-xl shadow-sky-900/5">
                <div className="flex items-center gap-3 mb-8">
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                    <h4 className="text-[10px] font-black text-black uppercase tracking-widest">Chiến binh online ({players.length})</h4>
                </div>
                <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                    {players.map(p => {
                      const isMe = p.username === studentName;
                      return (
                        <div key={p.id} className={cn(
                          "flex flex-col gap-2 p-4 hover:bg-slate-50 rounded-2xl transition-colors border border-transparent hover:border-slate-100 group",
                          isMe && "bg-sky-50/50 border-sky-100"
                        )}>
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 bg-sky-50 rounded-xl flex items-center justify-center text-sky-600 font-black text-xs border border-sky-100 group-hover:bg-sky-600 group-hover:text-white transition-all">
                                {p.username?.[0] || "?"}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-bold text-slate-800 truncate">{p.username}</p>
                                  {isMe && <span className="text-[8px] bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded font-black uppercase">Bạn</span>}
                                </div>
                                <p className={cn("text-[9px] font-black uppercase tracking-widest", p.status === "in-battle" ? "text-orange-500" : "text-green-500")}>
                                  {p.status === "in-battle" ? "Trong trận" : "Sẵn sàng"}
                                </p>
                            </div>
                          </div>
                          {isMe && (
                             <div className="flex items-center gap-4 pl-14 text-[9px] font-bold text-slate-400 uppercase tracking-tighter">
                                <span>TL Thắng: <span className="text-sky-600">{userStats.total > 0 ? Math.round((userStats.wins/userStats.total)*100) : 0}%</span></span>
                                <span>Tổng trận: <span className="text-sky-600">{userStats.total}</span></span>
                             </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ActiveBattle({ battleId, opponent, questions, scores, onFinish, isAiMode, totalXP }: any) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [timeLeft, setTimeLeft] = useState(30);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [oppScores, setOppScores] = useState<any>(scores);
  const [showExplanation, setShowExplanation] = useState(false);
  const [essayAnswer, setEssayAnswer] = useState("");
  const [isGrading, setIsGrading] = useState(false);
  const [hintUsed, setHintUsed] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [results, setResults] = useState<boolean[]>([]);

  useEffect(() => {
    setOppScores(scores);
  }, [scores]);

  useEffect(() => {
    if (isAnswered) return;
    
    // AI simulation logic
    if (isAiMode && !isAnswered) {
      const aiThinkingTime = Math.random() * 5000 + 4000;
      const timer = setTimeout(() => {
        const correct = Math.random() > 0.35;
        if (correct) {
          const aiPoints = 10 + Math.floor((30 - aiThinkingTime/1000));
          setOppScores((prev: any) => ({
            ...prev,
            [opponent.id]: (prev[opponent.id] || 0) + Math.max(0, aiPoints)
          }));
        }
      }, aiThinkingTime);
      return () => clearTimeout(timer);
    }
  }, [currentIdx, isAnswered]);

  useEffect(() => {
    if (isAnswered || showExplanation || showHint) return;
    
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          if (questions[currentIdx].options) handleAnswer(-1);
          else submitEssay();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [currentIdx, isAnswered, showExplanation, showHint]);

  const handleAnswer = (idx: number) => {
    if (isAnswered) return;
    
    const current = questions[currentIdx];
    const correct = idx === current.answerIndex;

    if (!correct && attempts === 0 && isAiMode) {
      setAttempts(1);
      setShowHint(true);
      return;
    }

    setSelectedIdx(idx);
    setIsAnswered(true);
    setResults(prev => [...prev, correct]);
    
    if (isAiMode) {
      let points = correct ? (10 + timeLeft) : 0;
      if (correct && attempts === 1) points += 30; // Hint correction bonus
      if (correct && current.difficulty === "Vận dụng") points += 20;

      setOppScores((prev: any) => ({
        ...prev,
        [socket.id]: (prev[socket.id] || 0) + points
      }));
      
      setTimeout(() => {
        setShowExplanation(true);
      }, 800);
    } else {
      socket.emit("submit-battle-answer", { battleId, correct, timeLeft });
      setTimeout(() => {
        if (currentIdx < questions.length - 1) {
          nextQuestion();
        } else {
          onFinish();
        }
      }, 1500);
    }
  };

  const submitEssay = async () => {
    if (isAnswered) return;
    setIsGrading(true);
    setIsAnswered(true);
    
    // Check for "copy-paste" (simplification: very fast high length)
    const isHonest = essayAnswer.length > 10; 
    const correct = isHonest && essayAnswer.length > 20;
    const points = correct ? (20 + timeLeft) : 0;
    
    setOppScores((prev: any) => ({
      ...prev,
      [socket.id]: (prev[socket.id] || 0) + points
    }));
    
    setIsGrading(false);
    setShowExplanation(true);
  };

  const nextQuestion = () => {
    setShowExplanation(false);
    setShowHint(false);
    setIsAnswered(false);
    setSelectedIdx(null);
    setEssayAnswer("");
    setTimeLeft(30);
    setAttempts(0);
    
    if (currentIdx < questions.length - 1) {
      setCurrentIdx(prev => prev + 1);
    } else {
      onFinish({ scores: oppScores, results });
    }
  };

  const current = questions[currentIdx];
  const isMultipleChoice = current.options && current.options.length > 0;
  const myScore = oppScores[socket.id] || 0;
  const oppScore = oppScores[opponent.id] || 0;

  return (
    <div className="max-w-5xl mx-auto pb-20">
       <div className="flex items-center justify-between mb-8 bg-white p-8 rounded-[2rem] border border-sky-50 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 h-1 w-32 bg-slate-100 rounded-full" />
          
          <div className="flex items-center gap-6 w-1/3">
             <div className="w-16 h-16 bg-sky-600 rounded-2xl flex items-center justify-center text-white font-black border-2 border-sky-100 shadow-sm relative">
                <UserIcon size={32} />
                <div className="absolute -bottom-2 -right-2 bg-orange-400 text-white px-2 py-0.5 rounded-full text-[8px] font-black shadow-sm">
                   LV.{Math.floor(totalXP/500) + 1}
                </div>
             </div>
             <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Của em</p>
                <div className="flex items-baseline gap-2">
                   <p className="text-3xl font-display font-black text-sky-900">{myScore}</p>
                   <span className="text-[10px] font-bold text-sky-500">XP</span>
                </div>
             </div>
          </div>

          <div className="flex flex-col items-center gap-3 w-1/3">
             <div className="relative">
                <svg className="w-24 h-24 transform -rotate-90">
                   <circle cx="48" cy="48" r="40" fill="transparent" stroke="#F1F5F9" strokeWidth="6" />
                   <circle cx="48" cy="48" r="40" fill="transparent" stroke="#14B8A6" strokeWidth="6" strokeDasharray={251.2} strokeDashoffset={251.2 * (1 - timeLeft/30)} className="transition-all duration-1000" />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                   <span className={cn("text-3xl font-display font-black leading-none", timeLeft < 10 ? "text-red-500 animate-pulse" : "text-sky-900")}>{timeLeft}</span>
                   <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest mt-1">Giây</span>
                </div>
             </div>
          </div>

          <div className="flex items-center justify-end gap-6 w-1/3 text-right">
             <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Đối thủ AI</p>
                <p className="text-3xl font-display font-black text-slate-900">{oppScore}</p>
             </div>
             <div className="w-16 h-16 bg-orange-50 rounded-2xl flex items-center justify-center text-orange-600 font-black border-2 border-orange-100 shadow-sm">
                <Bot size={32} />
             </div>
          </div>
       </div>

       <motion.div 
         key={currentIdx}
         initial={{ opacity: 0, x: 50 }}
         animate={{ opacity: 1, x: 0 }}
         className="bg-white rounded-[3rem] p-12 border border-sky-50 shadow-2xl relative"
       >
          <div className="flex items-center justify-between mb-10">
             <div className="flex items-center gap-3">
                <div className="px-4 py-2 bg-sky-600 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-lg">
                   Câu {currentIdx + 1} / {questions.length}
                </div>
                <div className="px-3 py-2 bg-slate-100 text-slate-400 rounded-xl font-black text-[9px] uppercase tracking-widest">
                   Độ khó: {current.difficulty || "Biết"}
                </div>
             </div>
             {isAnswered && isMultipleChoice && (
               <div className={cn("px-4 py-2 rounded-xl font-black text-xs uppercase tracking-widest shadow-md", 
                 selectedIdx === current.answerIndex ? "bg-emerald-100 text-emerald-600" : "bg-red-100 text-red-600")}>
                 {selectedIdx === current.answerIndex ? "Chính xác" : "Chưa đúng"}
               </div>
             )}
          </div>

          <h3 className="text-2xl md:text-3xl font-display font-black text-sky-900 mb-12 leading-snug">{current.question}</h3>
          
          {isMultipleChoice ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
               {current.options.map((opt: string, i: number) => {
                 const isCorrect = i === current.answerIndex;
                 const isSelected = selectedIdx === i;
                 
                 return (
                    <button 
                      key={i} 
                      onClick={() => handleAnswer(i)}
                      disabled={isAnswered || showHint}
                      className={cn(
                        "group p-8 rounded-[2rem] border-4 text-left transition-all relative overflow-hidden",
                        !isAnswered && !showHint
                          ? "bg-white border-slate-50 hover:border-sky-500 hover:shadow-2xl hover:-translate-y-1" 
                          : isCorrect && isAnswered
                            ? "bg-emerald-50 border-emerald-500 shadow-inner"
                            : isSelected 
                              ? "bg-red-50 border-red-500"
                              : "bg-slate-50 border-transparent opacity-50"
                      )}
                    >
                      <div className="flex items-center gap-6 relative z-10">
                         <span className={cn(
                           "w-10 h-10 rounded-xl flex items-center justify-center font-display font-black border-2 shadow-sm shrink-0",
                           !isAnswered 
                            ? "bg-white border-slate-200 text-slate-400 group-hover:bg-sky-600 group-hover:text-white group-hover:border-sky-400"
                            : isCorrect ? "bg-emerald-600 text-white border-emerald-400" : "bg-red-600 text-white border-red-400"
                         )}>
                            {String.fromCharCode(65 + i)}
                         </span>
                         <span className={cn("text-lg font-bold", isAnswered && isCorrect ? "text-emerald-900" : "text-slate-800")}>{opt}</span>
                      </div>
                    </button>
                 );
               })}
            </div>
          ) : (
            <div className="space-y-6">
               <textarea 
                 value={essayAnswer}
                 onChange={(e) => setEssayAnswer(e.target.value)}
                 disabled={isAnswered}
                 placeholder="Nhập câu trả lời của em tại đây (AI có khả năng phát hiện copy-paste)..."
                 className="w-full h-48 bg-slate-50 border-2 border-slate-100 rounded-3xl p-8 outline-none focus:border-sky-500 focus:bg-white transition-all font-medium text-lg leading-relaxed disabled:opacity-50"
               />
               {!isAnswered && (
                 <button 
                   onClick={submitEssay}
                   disabled={!essayAnswer.trim()}
                   className="w-full bg-sky-600 text-white font-black py-5 rounded-2xl hover:bg-sky-700 transition-all shadow-xl shadow-sky-200/50 flex items-center justify-center gap-3 active:scale-[0.98] uppercase tracking-widest text-xs"
                 >
                    {isGrading ? <Loader2 className="animate-spin" /> : "Gửi câu trả lời"}
                 </button>
               )}
            </div>
          )}

          <AnimatePresence>
             {showHint && (
               <motion.div 
                 initial={{ opacity: 0, scale: 0.9 }}
                 animate={{ opacity: 1, scale: 1 }}
                 className="mt-12 p-8 bg-orange-50 rounded-[2rem] border-2 border-orange-200 relative overflow-hidden"
               >
                  <Sparkles className="absolute top-2 right-2 text-orange-500 opacity-20" size={40} />
                  <div className="flex flex-col md:flex-row gap-6 items-center">
                     <div className="flex-1">
                        <div className="flex items-center gap-3 mb-3">
                           <AlertCircle className="text-orange-600" size={20} />
                           <p className="text-[10px] font-black text-orange-800 uppercase tracking-widest">Quy tắc Gợi ý thông minh:</p>
                        </div>
                        <p className="text-sm text-orange-900 font-bold leading-relaxed mb-1">Ồ, suy nghĩ lại một chút nhé! Đây là manh mối cho em:</p>
                        <p className="text-base text-orange-900 font-black italic">"{current.hint || "Hãy xem lại dữ kiện trong câu hỏi."}"</p>
                        <p className="text-[9px] text-orange-600 font-black uppercase mt-4">Em còn 1 cơ hội nữa - Tự sửa đúng sẽ được +30 XP!</p>
                     </div>
                     <button 
                       onClick={() => setShowHint(false)}
                       className="px-8 py-4 bg-orange-500 text-white rounded-2xl font-black shadow-lg shadow-orange-200 hover:bg-orange-600 transition-all uppercase tracking-widest text-[10px] whitespace-nowrap"
                     >
                       Thử lại lần 2
                     </button>
                  </div>
               </motion.div>
             )}

             {showExplanation && (
               <motion.div 
                 initial={{ opacity: 0, y: 20 }}
                 animate={{ opacity: 1, y: 0 }}
                 className="mt-12 p-8 bg-slate-50 rounded-[2rem] border border-slate-100"
               >
                  <div className="flex flex-col md:flex-row gap-6">
                     <div className="flex-1">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Gia sư AI chấm điểm & giải thích:</p>
                        <div className="prose prose-slate prose-sm max-w-none">
                           <p className="text-slate-600 font-medium italic leading-relaxed">{current.explanation}</p>
                        </div>
                     </div>
                     <div className="flex flex-col gap-3 justify-end">
                        <button 
                          onClick={nextQuestion}
                          className="px-8 py-4 bg-sky-600 text-white rounded-2xl font-black shadow-lg shadow-sky-100 hover:bg-sky-700 transition-all uppercase tracking-widest text-[10px] whitespace-nowrap"
                        >
                          {currentIdx < questions.length - 1 ? "Câu tiếp theo" : "Xem kết quả"}
                        </button>
                     </div>
                  </div>
               </motion.div>
             )}
          </AnimatePresence>
       </motion.div>
    </div>
  );
}

function StatBox({ label, value, icon, color }: any) {
  const colors: any = {
    sky: "bg-sky-50 text-sky-600 border-sky-100",
    orange: "bg-orange-50 text-orange-600 border-orange-100",
    green: "bg-green-50 text-green-600 border-green-100"
  };
  return (
    <div className={cn("p-6 rounded-3xl border text-center transition-all hover:scale-105", colors[color])}>
       <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm">
          {icon}
       </div>
       <p className="text-[9px] font-black uppercase tracking-widest mb-1 opacity-60 font-sans">{label}</p>
       <p className="text-xl font-display font-black">{value}</p>
    </div>
  );
}

function ResultCard({ name, score, winner, isOpponent = false }: any) {
  return (
    <div className={cn(
      "p-10 rounded-[2.5rem] border-4 transition-all relative overflow-hidden",
      winner 
        ? "bg-orange-50 border-orange-200 shadow-2xl shadow-orange-100" 
        : "bg-slate-50 border-slate-100"
    )}>
       {winner && (
         <div className="absolute -top-4 -right-4 w-24 h-24 bg-orange-400 rounded-full flex items-center justify-center text-white rotate-12 shadow-lg">
            <Trophy size={48} />
         </div>
       )}
       <div className="flex items-center gap-6 relative z-10">
          <div className={cn(
            "w-20 h-20 rounded-[1.5rem] flex items-center justify-center font-display font-black text-xl shadow-lg border-4",
            winner ? "bg-orange-400 text-white border-orange-300" : "bg-slate-300 text-white border-slate-200"
          )}>
             {isOpponent ? <Bot size={40} /> : <UserIcon size={40} />}
          </div>
          <div className="text-left">
             <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-1">{isOpponent ? "Đối thủ" : "Chiến binh"}</p>
             <h4 className="text-2xl font-display font-black text-sky-900 uppercase tracking-tight">{name}</h4>
             <div className="flex items-center gap-3 mt-4">
                <p className="text-5xl font-display font-black text-sky-600 leading-none">{score}</p>
                <div>
                   <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Điểm đấu</p>
                </div>
             </div>
          </div>
       </div>
    </div>
  );
}

function StatItem({ icon, label, value }: any) {
  return (
    <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-2xl">
       <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-sky-600 shadow-sm">
          {icon}
       </div>
       <div>
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{label}</p>
          <p className="font-bold text-slate-800">{value}</p>
       </div>
    </div>
  );
}

