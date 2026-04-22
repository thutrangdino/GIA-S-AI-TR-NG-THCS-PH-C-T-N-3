import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  MessageSquare, 
  BookOpen, 
  Beaker, 
  Trophy, 
  Settings, 
  User as UserIcon,
  Zap,
  ChevronRight,
  LogOut,
  Send,
  Image as ImageIcon,
  Mic,
  Star,
  Award,
  ShieldCheck,
  LogIn,
  Loader2,
  Menu,
  X,
  Shield
} from "lucide-react";
import { cn, getRank, RANKS } from "./lib/utils";
import { auth, googleProvider, db, syncStudentData, checkIfAdmin, studentLogin } from "./lib/firebase";
import { signInWithPopup, signInAnonymously, onAuthStateChanged, signOut, User } from "firebase/auth";
import { doc, onSnapshot, updateDoc, increment, setDoc, collection, query, orderBy, limit } from "firebase/firestore";
import { uploadFile } from "./lib/firebase";

// Mock Data / Components
import ChatInterface from "./components/chat/ChatInterface";
import QuizSection from "./components/assessment/QuizSection";
import Arena from "./components/arena/Arena";
import TeacherPanel from "./components/teacher/TeacherPanel";
import { ChallengePanel } from "./components/gamification/ChallengePanel";
import { Flame, Target } from "lucide-react";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [studentData, setStudentData] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [activeTab, setActiveTab] = useState("chat");
  const [isLoading, setIsLoading] = useState(true);
  const [showProfileEdit, setShowProfileEdit] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<"ranking" | "stats">("stats");
  const [newName, setNewName] = useState("");
  const [isUpdatingName, setIsUpdatingName] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [schoolLogo, setSchoolLogo] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Helper to check if a name belongs to the teacher
  const isTeacher = (name?: string) => {
    if (!name) return false;
    const normalized = name.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return normalized === "vu thi thu trang";
  };

  useEffect(() => {
    // Listen for global school config
    const configUnsubscribe = onSnapshot(doc(db, "config", "school"), (doc) => {
      if (doc.exists()) {
        setSchoolLogo(doc.data().logoUrl);
      }
    });

    let leaderboardUnsubscribe: (() => void) | null = null;
    let studentUnsubscribe: (() => void) | null = null;

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        await syncStudentData(currentUser);
        
        // Initial admin check
        const adminStatus = await checkIfAdmin(currentUser.uid) || 
                           isTeacher(currentUser.displayName || "") || 
                           currentUser.email === "thutrangdino@gmail.com";
        setIsAdmin(adminStatus);
        setNewName(currentUser.displayName || "");
        
        // Clean up previous listeners if any
        if (leaderboardUnsubscribe) leaderboardUnsubscribe();
        if (studentUnsubscribe) studentUnsubscribe();
        
        // Leaderboard listener (only if signed in)
        const q = query(collection(db, "students"), orderBy("xp", "desc"), limit(20));
        leaderboardUnsubscribe = onSnapshot(q, (snapshot) => {
          const rankings = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }));
          setLeaderboard(rankings);
        }, (error) => {
          console.error("Leaderboard error:", error);
        });

        studentUnsubscribe = onSnapshot(doc(db, "students", currentUser.uid), (doc) => {
          if (doc.exists()) {
             const data = doc.data();
             setStudentData(data);
             // Re-check admin status whenever student data updates
             if (isTeacher(data.displayName) || data.isAdmin || isTeacher(user?.displayName || "")) {
               setIsAdmin(true);
             }
          }
        });
      } else {
        setStudentData(null);
        setIsAdmin(false);
        if (leaderboardUnsubscribe) leaderboardUnsubscribe();
        if (studentUnsubscribe) studentUnsubscribe();
      }
      setIsLoading(false);
    });

    return () => {
      unsubscribe();
      configUnsubscribe();
      if (leaderboardUnsubscribe) leaderboardUnsubscribe();
      if (studentUnsubscribe) studentUnsubscribe();
    };
  }, []);

  const handleLogout = () => signOut(auth);

  const handleUpdateName = async () => {
    if (!user || !newName.trim() || isUpdatingName) return;
    setIsUpdatingName(true);
    try {
      await syncStudentData(user, { displayName: newName.trim() });
      setShowProfileEdit(false);
      setActiveTab("chat"); // Return to main screen (Chat tab)
    } catch (error) {
      console.error("Lỗi cập nhật tên:", error);
      alert("Không thể lưu tên. Vui lòng thử lại.");
    } finally {
      setIsUpdatingName(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!user || !file || isUploading) return;
    
    setIsUploading(true);
    try {
      const url = await uploadFile(file, `avatars/${user.uid}`);
      await syncStudentData(user, { photoURL: url });
    } catch (error) {
      console.error("Lỗi tải ảnh:", error);
      alert("Không thể tải ảnh. Vui lòng kiểm tra dung lượng và thử lại.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleSchoolLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!isAdmin || !file || isUploading) return;

    setIsUploading(true);
    try {
      const url = await uploadFile(file, `config/school_logo`);
      await setDoc(doc(db, "config", "school"), { logoUrl: url }, { merge: true });
    } catch (error) {
      console.error("Lỗi tải ảnh trường:", error);
      alert("Không thể tải ảnh trường. Vui lòng thử lại.");
    } finally {
      setIsUploading(false);
    }
  };

  const addXP = async (amount: number) => {
    if (!user) return;
    const studentRef = doc(db, "students", user.uid);
    let newLevel = studentData?.level || "Tập sự";
    const newXP = (studentData?.xp || 0) + amount;
    
    if (newXP >= 500) newLevel = "Bác học";
    else if (newXP >= 100) newLevel = "Chuyên gia";

    await updateDoc(studentRef, {
      xp: increment(amount),
      level: newLevel
    });
  };

  return (
    <AnimatePresence mode="wait">
      {isLoading && !user ? (
        <motion.div 
          key="loader"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="min-h-screen bg-[#F0FDFA] flex items-center justify-center"
        >
          <div className="text-center">
            <Loader2 className="animate-spin text-sky-600 mx-auto mb-4" size={48} />
            <p className="text-sky-900 font-bold text-sm tracking-widest uppercase">Đang khởi tạo...</p>
          </div>
        </motion.div>
      ) : !user ? (
        <motion.div 
          key="login"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className="w-full"
        >
          <LoginScreen schoolLogo={schoolLogo} />
        </motion.div>
      ) : (
        <motion.div 
          key="main"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col h-screen w-full bg-[#f8fafc] font-sans overflow-hidden"
        >
          <div className="p-6 flex-1 flex flex-col space-y-4 overflow-hidden max-w-[1400px] mx-auto w-full">
            {/* Header Navigation */}
            <header className="flex items-center justify-between bg-white px-6 py-3 rounded-2xl shadow-sm border border-slate-100 shrink-0">
              <div className="flex items-center space-x-3">
                {schoolLogo ? (
                 <img 
                    src="https://storage.googleapis.com/genai-agent-user-files/0e32152a-9f5b-4395-8e2b-f41a877992fc/input_file_0.png" 
                    alt="School Logo" 
                    className="h-[60px] w-auto object-contain transition-transform duration-300 hover:scale-105"
                 />
                ) : (
                  <div className="w-10 h-10 bg-sky-50 rounded-lg flex items-center justify-center text-sky-600 border border-sky-100">
                    <UserIcon size={20} />
                  </div>
                )}
                <div className="flex flex-col items-start hidden md:block">
                  <h1 className="text-xl font-bold text-sky-900 leading-none tracking-tight uppercase">Gia sư AI KHTN</h1>
                  <p className="text-[10px] text-black font-black mt-1">Khám phá tri thức - Kiến tạo tương lai</p>
                </div>
              </div>

              <nav className="hidden md:flex flex-1 justify-evenly px-8 text-sm font-bold text-black font-sans">
                <HorizontalNavItem active={activeTab === "chat"} onClick={() => setActiveTab("chat")} label="TRỢ LÝ HỌC TẬP" />
                <HorizontalNavItem active={activeTab === "quiz"} onClick={() => setActiveTab("quiz")} label="ÔN TẬP" />
                <HorizontalNavItem active={activeTab === "arena"} onClick={() => setActiveTab("arena")} label="ĐẤU TRƯỜNG TRÍ TUỆ" />
              </nav>

              <div className="flex items-center space-x-4">
                {/* Mobile Menu Toggle */}
                <button 
                  className="md:hidden p-2 text-black z-50 relative"
                  onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                >
                  {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
                </button>
                <div className="text-right hidden sm:block">
                  <p className="text-[10px] text-black font-black uppercase tracking-widest">Học sinh</p>
                  <div className="flex items-center group/name cursor-pointer" onClick={() => setShowProfileEdit(true)}>
                    <p className="text-sm font-bold text-black group-hover/name:text-sky-600 transition-colors">{studentData?.displayName || user.displayName || "Đang tải..."}</p>
                    <Settings size={12} className="ml-1.5 text-black group-hover/name:text-sky-400 transition-colors" />
                  </div>
                </div>
                <div className="group relative z-40">
                  <motion.div 
                    whileHover={{ scale: 1.1, boxShadow: "0 0 15px rgba(14, 165, 233, 0.2)" }}
                    className="w-10 h-10 bg-white rounded-xl border-2 border-slate-200 overflow-hidden cursor-pointer shadow-sm transition-all"
                  >
                    {studentData?.photoURL || user.photoURL ? <img src={studentData?.photoURL || user.photoURL} alt="Avatar" referrerPolicy="no-referrer" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center bg-white text-sky-600 font-bold text-lg">{studentData?.displayName?.[0]?.toUpperCase() || user.displayName?.[0]?.toUpperCase() || "?"}</div>}
                  </motion.div>
                  <div className="absolute right-0 mt-3 w-48 bg-white rounded-2xl shadow-2xl border border-slate-100 p-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all">
                     <button 
                       onClick={() => setShowProfileEdit(true)}
                       className="w-full flex items-center gap-3 p-3 text-xs font-bold text-sky-600 hover:bg-sky-50 rounded-xl transition-colors mb-1"
                     >
                       <UserIcon size={16} />
                       Sửa đổi họ tên
                     </button>
                     <button 
                       onClick={handleLogout}
                       className="w-full flex items-center gap-3 p-3 text-xs font-bold text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                     >
                       <LogOut size={16} />
                       Đăng xuất tài khoản
                     </button>
                  </div>
                </div>
              </div>
            </header>

            {/* Mobile Menu Dropdown */}
            <AnimatePresence>
              {isMobileMenuOpen && (
                <motion.div 
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="md:hidden absolute top-[80px] left-6 right-6 bg-white rounded-2xl shadow-2xl border border-slate-100 p-4 z-40 flex flex-col gap-2"
                >
                  <button onClick={() => { setActiveTab("chat"); setIsMobileMenuOpen(false); }} className={cn("p-4 rounded-xl text-sm font-bold w-full text-left", activeTab === "chat" ? "bg-sky-50 text-sky-600" : "text-slate-600")}>TRỢ LÝ HỌC TẬP</button>
                  <button onClick={() => { setActiveTab("quiz"); setIsMobileMenuOpen(false); }} className={cn("p-4 rounded-xl text-sm font-bold w-full text-left", activeTab === "quiz" ? "bg-sky-50 text-sky-600" : "text-slate-600")}>ÔN TẬP</button>
                  <button onClick={() => { setActiveTab("arena"); setIsMobileMenuOpen(false); }} className={cn("p-4 rounded-xl text-sm font-bold w-full text-left", activeTab === "arena" ? "bg-sky-50 text-sky-600" : "text-slate-600")}>ĐẤU TRƯỜNG TRÍ TUỆ</button>
                </motion.div>
              )}
            </AnimatePresence>

          {/* Profile Edit Modal */}
          {showProfileEdit && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-sky-900/40 backdrop-blur-sm">
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-white rounded-[2.5rem] p-8 w-full max-w-sm shadow-2xl border border-sky-50"
              >
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-xl font-display font-black text-sky-900 tracking-tight">Cập nhật họ tên</h3>
                  <button onClick={() => setShowProfileEdit(false)} className="text-slate-400 hover:text-slate-600 p-1">
                    <LogOut size={20} className="rotate-180" />
                  </button>
                </div>
                
                <div className="space-y-4">
                  <div className="flex flex-col items-center mb-6">
                    <div className="relative group/avatar">
                      <div className="w-24 h-24 rounded-full border-4 border-sky-50 overflow-hidden shadow-lg bg-sky-50 flex items-center justify-center">
                        {(studentData?.photoURL || user.photoURL) ? (
                          <img src={studentData?.photoURL || user.photoURL} alt="Avatar" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          <span className="text-3xl font-bold text-sky-600">{studentData?.displayName?.[0] || "?"}</span>
                        )}
                        {isUploading && (
                          <div className="absolute inset-0 bg-white/60 flex items-center justify-center">
                            <Loader2 className="animate-spin text-sky-600" size={24} />
                          </div>
                        )}
                      </div>
                      <label className="absolute bottom-0 right-0 p-2 bg-sky-600 text-white rounded-full shadow-lg cursor-pointer hover:bg-sky-700 transition-all">
                        <ImageIcon size={16} />
                        <input type="file" className="hidden" accept="image/*" onChange={handleAvatarUpload} />
                      </label>
                    </div>
                    <p className="text-[10px] font-black text-black uppercase tracking-widest mt-3">Ảnh đại diện của em</p>
                  </div>

                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex flex-col gap-2">
                    <p className="text-[10px] font-black text-black uppercase tracking-widest">Mã định danh (UID) của em</p>
                    <div className="flex items-center justify-between gap-2 overflow-hidden">
                       <code className="text-[10px] font-mono text-sky-700 truncate bg-white px-2 py-1 rounded border border-sky-50 flex-1">{user.uid}</code>
                       <button 
                         onClick={() => {
                           navigator.clipboard.writeText(user.uid);
                           alert("Đã sao chép mã UID!");
                         }} 
                         className="p-1.5 hover:bg-sky-100 rounded-lg text-sky-600 transition-colors shrink-0" 
                         title="Sao chép UID"
                       >
                         <Zap size={14} />
                       </button>
                    </div>
                  </div>

                  <div className="text-left">
                    <label className="block text-[10px] font-bold text-black uppercase tracking-[0.2em] mb-2 ml-4">
                      Họ và tên mới
                    </label>
                    <input 
                      type="text"
                      autoFocus
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Nhập tên thật của em..."
                      className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 outline-none focus:border-sky-500 transition-all font-bold text-sky-900"
                    />
                  </div>
                  
                  <div className="p-4 bg-sky-50 rounded-2xl border border-sky-100">
                    <p className="text-[11px] text-sky-700 leading-relaxed font-medium">
                      Họ tên này sẽ được dùng để **ghi nhận kết quả** của em khi tham gia thử thách và lưu danh trên Bảng xếp hạng.
                    </p>
                  </div>

                  <button 
                    onClick={handleUpdateName}
                    disabled={!newName.trim() || isUpdatingName}
                    className="w-full bg-sky-600 text-white font-black py-4 rounded-2xl shadow-lg shadow-sky-200/50 hover:bg-sky-700 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
                  >
                    {isUpdatingName ? <Loader2 className="animate-spin" size={20} /> : "Lưu tên & Cập nhật"}
                  </button>
                </div>
              </motion.div>
            </div>
          )}

          <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 overflow-hidden">
            
            {/* Sidebar/Aside - LEFT on desktop */}
            <aside className="hidden lg:flex lg:col-span-3 lg:order-1 space-y-6 overflow-hidden flex-col h-full">
              {/* XP & Level Card */}
              <div className="bg-white rounded-[2rem] p-8 shadow-md border border-sky-50/50 flex-shrink-0 relative overflow-hidden group">
                <div className="flex justify-between items-start mb-6">
                   <div className="flex flex-col gap-1">
                      <h3 className="font-bold text-black uppercase text-[10px] tracking-[0.2em]">Cấp độ hiện tại</h3>
                      <span className="text-4xl font-display font-black text-sky-600 tracking-tighter">
                        {(studentData?.xp || 0).toLocaleString()} 
                        <span className="text-xs text-black font-black uppercase ml-2 tracking-widest">XP</span>
                      </span>
                   </div>
                   <div className="flex flex-col items-end gap-2">
                      <span className="bg-orange-100 text-orange-700 px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest border border-orange-200">
                        {getRank(studentData?.xp || 0).name}
                      </span>
                      {studentData?.streak && studentData.streak > 1 && (
                        <div className="flex items-center gap-1 bg-orange-100 text-orange-600 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border border-orange-200">
                          <Flame size={12} className="fill-orange-500" />
                          {studentData.streak} Ngày
                        </div>
                      )}
                   </div>
                </div>
                
                <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden shadow-inner p-0.5 mb-2">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(((studentData?.xp || 0) / (getRank(studentData?.xp || 0).max === Infinity ? 1 : getRank(studentData?.xp || 0).max)) * 100, 100)}%` }}
                    className="bg-sky-500 h-full rounded-full shadow-[0_0_8px_rgba(2,132,199,0.4)]"
                  />
                </div>
                <p className="text-[10px] text-right text-black font-black uppercase tracking-widest">
                    {getRank(studentData?.xp || 0).max !== Infinity 
                      ? `+${(getRank(studentData?.xp || 0).max + 1) - (studentData?.xp || 0)} XP ĐẾN ${RANKS[RANKS.findIndex(r => r.name === getRank(studentData?.xp || 0).name) + 1]?.name?.toUpperCase() || ''}` 
                      : "Cấp độ tối đa"}
                </p>
              </div>

              {/* Sidebar Tabs */}
              <div className="flex-1 bg-white rounded-[2rem] shadow-md border border-sky-50/50 overflow-hidden flex flex-col">
                <div className="flex items-center p-2 bg-slate-50/50">
                  <button 
                    onClick={() => setSidebarTab("stats")}
                    className={cn(
                      "flex-1 py-3 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2",
                      sidebarTab === "stats" ? "bg-white text-sky-600 shadow-sm border border-slate-100" : "text-black font-bold hover:text-sky-500"
                    )}
                  >
                    <Target size={14} /> Thử thách
                  </button>
                  <button 
                    onClick={() => setSidebarTab("ranking")}
                    className={cn(
                      "flex-1 py-3 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2",
                      sidebarTab === "ranking" ? "bg-white text-sky-600 shadow-sm border border-slate-100" : "text-black font-bold hover:text-sky-500"
                    )}
                  >
                    <Trophy size={14} /> Xếp hạng
                  </button>
                </div>

                <div className="p-6 flex-1 overflow-hidden">
                   <AnimatePresence mode="wait">
                      {sidebarTab === "stats" ? (
                        <motion.div
                          key="stats"
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 10 }}
                          className="h-full"
                        >
                          <ChallengePanel studentData={studentData} />
                        </motion.div>
                      ) : (
                        <motion.div
                          key="ranking"
                          initial={{ opacity: 0, x: 10 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -10 }}
                          className="h-full flex flex-col"
                        >
                          <div className="flex items-center justify-between mb-6">
                            <h3 className="font-bold text-black uppercase text-[10px] tracking-[0.2em]">Bảng xếp hạng tuần</h3>
                            <Award size={16} className="text-orange-500" />
                          </div>
                          <div className="space-y-3 overflow-y-auto custom-scrollbar flex-1 pr-2">
                             {leaderboard.map((player, i) => {
                               const isActive = player.id === user?.uid;
                               const rankDisplay = (i + 1).toString().padStart(2, '0');
                               const rawName = player.displayName || "Học sinh";
                               const displayName = isActive ? (studentData?.displayName || rawName) : rawName;
                               
                               return (
                               <div key={player.id} className={cn(
                                 "flex items-center justify-between p-4 rounded-2xl transition-all border",
                                 isActive ? "bg-sky-50 border-sky-100 shadow-sm" : "bg-white border-transparent hover:bg-slate-50"
                               )}>
                                 <div className="flex items-center space-x-4">
                                   <span className={cn("w-5 text-[10px] font-black", isActive ? "text-sky-700" : "text-black")}>{rankDisplay}</span>
                                   <div className="w-10 h-10 rounded-full bg-slate-100 border-2 border-white shadow-sm flex items-center justify-center font-bold text-xs text-black overflow-hidden">
                                     {player.photoURL ? (
                                        <img src={player.photoURL} alt="Avatar" className="w-full h-full object-cover" />
                                     ) : (
                                        displayName[0]?.toUpperCase() || "?"
                                     )}
                                   </div>
                                   <span className={cn("text-xs font-bold truncate max-w-[100px]", isActive ? "text-sky-900" : "text-black")}>{displayName}</span>
                                 </div>
                                 <span className={cn("text-xs font-black", isActive ? "text-sky-600" : "text-black text-opacity-70")}>{(player.xp || 0).toLocaleString()}</span>
                               </div>
                             )})}
                          </div>
                        </motion.div>
                      )}
                   </AnimatePresence>
                </div>
              </div>

              {/* Arena Callout */}
              <div className="bg-orange-50 rounded-[2rem] p-8 border border-orange-100 flex-shrink-0 shadow-sm relative overflow-hidden group">
                <div className="relative z-10">
                  <h3 className="font-bold text-orange-800 text-sm flex items-center tracking-tight uppercase">
                    <Star size={16} className="mr-2 fill-orange-500 text-orange-500 animate-pulse" />
                    ĐẤU TRƯỜNG ĐANG MỞ
                  </h3>
                  <p className="text-[11px] text-orange-700 mt-3 mb-5 leading-relaxed font-medium">Thách đấu cùng <b>bạn khác</b> đang online để nhận X2 điểm thưởng.</p>
                  <button 
                    onClick={() => setActiveTab("arena")}
                    className="w-full bg-orange-500 text-white font-black py-4 rounded-2xl text-[10px] uppercase tracking-widest hover:bg-orange-600 transition-all shadow-lg shadow-orange-200/50 active:scale-[0.98]"
                  >
                    THAM GIA
                  </button>
                </div>
                {/* Visual Interest */}
                <div className="absolute top-[-20%] right-[-10%] w-32 h-32 bg-orange-200/20 rounded-full blur-2xl group-hover:scale-110 transition-transform"></div>
              </div>
            </aside>

            {/* Main Content Area - RIGHT on desktop */}
            <div className="col-span-1 lg:col-span-9 lg:order-2 flex flex-col space-y-6 overflow-hidden h-full">
              <div className="flex-1 glass-card rounded-[2rem] p-8 shadow-sm border border-sky-50/50 overflow-hidden bg-white/40 backdrop-blur-xl">
                 <AnimatePresence mode="wait">
                    <motion.div
                      key={activeTab}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.2 }}
                      className="h-full"
                    >
                      {activeTab === "chat" && <ChatInterface studentName={studentData?.displayName || user.displayName || "Học sinh"} addXP={addXP} userId={user.uid} />}
                      {activeTab === "quiz" && <QuizSection studentName={studentData?.displayName || user.displayName || "Học sinh"} addXP={addXP} userId={user.uid} />}
                      {activeTab === "arena" && (
                        <Arena 
                          studentName={studentData?.displayName || user.displayName || "Học sinh"} 
                          addXP={addXP} 
                          totalXP={studentData?.xp || 0}
                        />
                      )}
                      {activeTab === "teacher" && (
                        <TeacherPanel 
                          schoolLogo={schoolLogo} 
                          onLogoUpload={handleSchoolLogoUpload} 
                          isUploadingLogo={isUploading} 
                        />
                      )}
                    </motion.div>
                 </AnimatePresence>
              </div>
            </div>
          </div>

          {/* Footer */}
          <footer className="hidden md:flex flex-col md:flex-row items-center justify-between gap-4 text-[10px] text-black font-normal tracking-widest uppercase px-6 py-4 shrink-0 bg-white/50 border-t border-sky-100 max-w-[1400px] mx-auto w-full">
            <p className="text-center md:text-left">© 2026 GIA SƯ AI KHTN TRƯỜNG THCS PHƯỚC TÂN 3 – Thiết kế và phát triển bởi cô Vũ Thị Thu Trang</p>
            <div className="flex items-center space-x-6">
              <span className="flex items-center">
                <div className="w-1.5 h-1.5 bg-green-500 rounded-full mr-2 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.8)]"></div> 
                Hệ thống ổn định
              </span>
              <span className="opacity-60">Phiên bản v2.0.1</span>
            </div>
          </footer>

          {/* Mobile Bottom Navigation */}
          <div className="md:hidden fixed bottom-6 left-6 right-6 bg-white shadow-2xl rounded-[1.5rem] border border-sky-100 p-2 z-[60] flex items-center justify-around">
            <MobileNavItem active={activeTab === "chat"} onClick={() => setActiveTab("chat")} icon={<MessageSquare size={20} />} label="Trợ lý" />
            <MobileNavItem active={activeTab === "quiz"} onClick={() => setActiveTab("quiz")} icon={<BookOpen size={20} />} label="Ôn tập" />
            <MobileNavItem active={activeTab === "arena"} onClick={() => setActiveTab("arena")} icon={<Trophy size={20} />} label="Đấu trường" />
            {isAdmin && <MobileNavItem active={activeTab === "teacher"} onClick={() => setActiveTab("teacher")} icon={<Settings size={20} />} label="Quản lý" />}
          </div>
        </div>
      </motion.div>
      )}
    </AnimatePresence>
  );
}

function HorizontalNavItem({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "relative pb-1 transition-all border-b-2 flex-1 text-center min-w-[120px]",
        active ? "text-sky-600 border-sky-600" : "text-black font-bold border-transparent hover:text-sky-600"
      )}
    >
      {label}
      {active && (
        <motion.div 
          layoutId="nav-glow"
          className="absolute -bottom-[2px] left-0 right-0 h-[2px] bg-sky-600 shadow-[0_0_8px_rgba(45,212,191,0.8)]"
        />
      )}
    </button>
  );
}

function MobileNavItem({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1 p-2 rounded-xl transition-all",
        active ? "text-sky-600 bg-sky-50" : "text-black opacity-60"
      )}
    >
      {icon}
      <span className="text-[10px] font-black uppercase tracking-tighter">{label}</span>
    </button>
  );
}


function LoginScreen({ schoolLogo }: { schoolLogo: string | null }) {
  const [studentName, setStudentName] = useState("");
  const [password, setPassword] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedImageFile(file);
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    }
  };

  const handleLogin = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!studentName.trim() || !password.trim() || isLoggingIn) return;

    setIsLoggingIn(true);
    try {
      const user = await studentLogin(studentName.trim(), password.trim());
      
      if (selectedImageFile) {
         try {
            const uploadedUrl = await uploadFile(selectedImageFile, `avatars/${user.uid}`);
            await syncStudentData(user, { photoURL: uploadedUrl });
         } catch (uploadError) {
            console.error("Upload error:", uploadError);
         }
      }

    } catch (error: any) {
      console.error("Lỗi đăng nhập:", error);
      alert(error.message || "Có lỗi xảy ra khi bắt đầu. Vui lòng thử lại.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  return (
    <div className="min-h-screen bg-sky-600 flex items-center justify-center p-6 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-sky-500 to-sky-700">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md bg-white rounded-3xl shadow-2xl p-10 text-center"
      >
        <div className={cn(
          "relative w-32 h-32 mx-auto mb-8 bg-sky-50 rounded-3xl flex items-center justify-center border-2 border-sky-100 shadow-md overflow-hidden group transition-all",
          !schoolLogo && "cursor-pointer hover:scale-105"
        )}>
          {!schoolLogo && (
            <label className="absolute inset-0 z-10 cursor-pointer">
              <input type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
            </label>
          )}
          
          {(previewUrl || "https://storage.googleapis.com/genai-agent-user-files/0e32152a-9f5b-4395-8e2b-f41a877992fc/input_file_0.png") ? (
            <img 
              src={previewUrl || "https://storage.googleapis.com/genai-agent-user-files/0e32152a-9f5b-4395-8e2b-f41a877992fc/input_file_0.png"} 
              alt="School Logo" 
              className="h-[60px] w-auto object-contain transition-transform duration-300 hover:scale-105"
              style={{ imageRendering: 'auto' }}
            />
          ) : (
            <UserIcon size={48} className="text-sky-300" />
          )}

          {!schoolLogo && (
            <div className="absolute inset-0 bg-sky-900/40 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
              <ImageIcon size={24} className="text-white mb-2" />
              <span className="text-white text-[10px] font-black uppercase tracking-widest text-center px-2">Cập nhật ảnh</span>
            </div>
          )}
        </div>
        
        <div className="mb-8">
          <h1 className="text-3xl font-display font-black text-sky-900 mb-2 tracking-tight">Gia sư AI KHTN</h1>
          <p className="text-black font-bold text-sm tracking-tight uppercase">Trường THCS Phước Tân 3</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="text-left">
            <label className="block text-[10px] font-bold text-black uppercase tracking-widest mb-1.5 ml-4 text-slate-400">
              Họ và tên của em
            </label>
            <input 
              type="text"
              required
              value={studentName}
              onChange={(e) => setStudentName(e.target.value)}
              placeholder="Nhập tên chính xác của em..."
              className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 outline-none focus:border-sky-500 transition-all font-bold text-sky-900"
            />
          </div>

          <div className="text-left">
            <label className="block text-[10px] font-bold text-black uppercase tracking-widest mb-1.5 ml-4 text-slate-400">
              Mật khẩu truy cập
            </label>
            <input 
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Nhập mật khẩu của em..."
              className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 outline-none focus:border-sky-500 transition-all font-bold text-sky-900"
            />
          </div>

          <button 
            type="submit"
            disabled={!studentName.trim() || !password.trim() || isLoggingIn}
            className="w-full bg-sky-600 text-white font-black py-5 rounded-2xl shadow-xl shadow-sky-200/50 hover:bg-sky-700 transition-all flex items-center justify-center gap-3 disabled:opacity-50 active:scale-95 uppercase tracking-widest text-xs"
          >
            {isLoggingIn ? (
              <Loader2 className="animate-spin" size={24} />
            ) : (
              <>
                Đăng nhập
                <ChevronRight size={20} />
              </>
            )}
          </button>
        </form>

        <p className="mt-8 text-[10px] text-slate-400 font-bold leading-relaxed bg-slate-50 px-6 py-4 rounded-3xl border border-slate-100 text-left italic">
          💡 <b>Lưu ý:</b> Nếu là lần đầu, em hãy tự đặt một mật khẩu. Lần sau chỉ cần đúng <b>Tên & Mật khẩu</b> này là điểm XP cũ sẽ được giữ nguyên.
        </p>

        <p className="mt-10 text-[9px] text-slate-400 font-medium uppercase tracking-widest leading-relaxed">
          © 2026 GIA SƯ AI KHTN TRƯỜNG THCS PHƯỚC TÂN 3<br/>Phát triển bởi cô Vũ Thị Thu Trang
        </p>
      </motion.div>
    </div>
  );
}

function ExperimentList() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {[1, 2, 3].map(i => (
        <div key={i} className="bg-white border border-sky-50 rounded-3xl p-6 card-shadow hover:-translate-y-1 transition-transform cursor-pointer">
           <div className="w-12 h-12 bg-sky-50 rounded-2xl flex items-center justify-center text-sky-600 mb-4">
              <Beaker size={24} />
           </div>
           <h3 className="font-display font-bold text-sky-900 text-lg mb-2">Thí nghiệm {i}: Tán sắc ánh sáng</h3>
           <p className="text-sm text-black font-bold leading-relaxed underline decoration-sky-100 decoration-4">Tìm hiểu về cách ánh sáng trắng phân tách thành dải màu cầu vồng qua lăng kính.</p>
           <div className="mt-6 pt-6 border-t border-sky-50 flex items-center justify-between">
              <span className="text-[10px] bg-sky-100 text-sky-700 px-2 py-1 rounded-full font-bold uppercase">Mức độ: Dễ</span>
              <ChevronRight size={16} className="text-sky-400" />
           </div>
        </div>
      ))}
    </div>
  );
}

