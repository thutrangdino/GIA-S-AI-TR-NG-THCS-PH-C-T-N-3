import React from 'react';
import { motion } from 'motion/react';
import { Trophy, Flame, Target, CheckCircle2, Award, Sparkles, Zap } from 'lucide-react';
import { StudentData } from '../../lib/firebase';

interface Challenge {
  id: string;
  title: string;
  description: string;
  xpReward: number;
  icon: React.ReactNode;
}

const DAILY_CHALLENGES: Challenge[] = [
  { id: 'chat_3', title: 'Người tò mò', description: 'Gửi 3 câu hỏi cho Gia sư AI', xpReward: 50, icon: <Sparkles size={18} /> },
  { id: 'quiz_master', title: 'Chủ khảo nhanh', description: 'Hoàn thành 1 bài trắc nghiệm > 80%', xpReward: 100, icon: <Target size={18} /> },
  { id: 'multi_subject', title: 'Đa tài', description: 'Ôn tập 2 chủ đề khác nhau', xpReward: 75, icon: <Zap size={18} /> },
];

const BADGE_LIST = [
  { id: 'pioneer', name: 'Người tiên phong', icon: '🚀', description: 'Tham gia hệ thống những ngày đầu' },
  { id: 'streak_7', name: 'Bền bỉ', icon: '🔥', description: 'Đạt chuỗi 7 ngày học liên tiếp' },
  { id: 'top_1', name: 'Quán quân', icon: '🥇', description: 'Đứng đầu bảng xếp hạng tuần' },
  { id: 'master_atom', name: 'Bác học nguyên tử', icon: '⚛️', description: 'Hoàn thành mọi bài tập về Nguyên tử' },
];

export function ChallengePanel({ studentData }: { studentData: StudentData | null }) {
  const completedIds = studentData?.completedChallenges || [];
  const streak = studentData?.streak || 0;

  return (
    <div className="space-y-6 h-full overflow-y-auto pr-2 custom-scrollbar">
      {/* Streak Section */}
      <div className="bg-gradient-to-br from-orange-400 to-red-500 rounded-3xl p-6 text-white shadow-lg shadow-orange-200">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2 rounded-xl backdrop-blur-sm">
              <Flame size={24} className="fill-white" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest opacity-80">Chuỗi học tập</p>
              <h3 className="text-2xl font-black">{streak} ngày liên tiếp</h3>
            </div>
          </div>
          <motion.div 
            animate={{ scale: [1, 1.2, 1] }} 
            transition={{ repeat: Infinity, duration: 2 }}
            className="text-3xl"
          >
            🔥
          </motion.div>
        </div>
        <p className="text-xs opacity-90 leading-relaxed font-medium">
          Duy trì việc học mỗi ngày để nhận thêm x1.5 EXP và mở khóa danh hiệu hiếm!
        </p>
      </div>

      {/* Daily Challenges */}
      <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm">
        <div className="flex items-center gap-2 mb-6">
          <Target size={20} className="text-sky-600" />
          <h3 className="font-bold text-sky-900 text-sm uppercase tracking-tight">Thử thách hôm nay</h3>
        </div>
        <div className="space-y-4">
          {DAILY_CHALLENGES.map((challenge) => {
            const isCompleted = completedIds.includes(challenge.id);
            return (
              <div 
                key={challenge.id}
                className={`p-4 rounded-2xl border transition-all ${
                  isCompleted ? 'bg-sky-50 border-sky-100 opacity-75' : 'bg-slate-50 border-slate-100 hover:border-sky-200'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-xl ${isCompleted ? 'bg-sky-600 text-white' : 'bg-white text-sky-600 border border-sky-50'}`}>
                    {isCompleted ? <CheckCircle2 size={18} /> : challenge.icon}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h4 className={`text-sm font-bold ${isCompleted ? 'text-sky-900 line-through' : 'text-slate-800'}`}>
                        {challenge.title}
                      </h4>
                      <span className="text-[10px] font-black text-sky-600">+{challenge.xpReward} EXP</span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">{challenge.description}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Badges Section */}
      <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm">
        <div className="flex items-center gap-2 mb-6">
          <Award size={20} className="text-sky-600" />
          <h3 className="font-bold text-sky-900 text-sm uppercase tracking-tight">Danh hiệu của em</h3>
        </div>
        <div className="grid grid-cols-2 gap-4">
          {BADGE_LIST.map((badge) => {
            const hasBadge = studentData?.badges?.includes(badge.id);
            return (
              <div 
                key={badge.id}
                className={`p-4 rounded-2xl border text-center transition-all ${
                  hasBadge ? 'bg-sky-50 border-sky-200' : 'bg-slate-50 border-slate-100 grayscale opacity-40'
                }`}
              >
                <div className="text-3xl mb-2">{badge.icon}</div>
                <h4 className="text-[10px] font-black text-sky-900 uppercase tracking-tighter leading-tight h-8 flex items-center justify-center">
                  {badge.name}
                </h4>
                {hasBadge && (
                  <p className="text-[9px] text-sky-600 mt-1 font-bold">Đã đạt</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
