import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const RANKS = [
  { name: "Tập sự Khoa học", min: 0, max: 1000, level: "1-5", perk: "Gợi ý chi tiết" },
  { name: "Chuyên viên Thí nghiệm", min: 1001, max: 5000, level: "6-15", perk: "Mở khóa STEM & Thực hành ảo" },
  { name: "Nhà Thông thái KHTN", min: 5001, max: 15000, level: "16-30", perk: "Tham gia Bảng xếp hạng Vàng" },
  { name: "Phù thủy AI Lab", min: 15001, max: Infinity, level: "31+", perk: "Trợ lý của cô Trang" }
];

export function getRank(xp: number) {
  return RANKS.find(r => xp >= r.min && xp <= r.max) || RANKS[0];
}

export const formatXP = (xp: number) => {
  if (xp >= 1000) return `${(xp / 1000).toFixed(1)}k`;
  return xp.toString();
};

export const getLevel = (xp: number) => {
  const rank = getRank(xp);
  return { title: rank.name, color: "text-orange-600", bg: "bg-orange-100" };
};

export const processLaTeX = (text: string) => {
  if (!text) return "";
  let processed = text.replace(/\\\((.*?)\\\)/gs, '$$$1$$');
  processed = processed.replace(/\\\[(.*?)\\\]/gs, '$$$$$1$$$$');
  return processed;
};
