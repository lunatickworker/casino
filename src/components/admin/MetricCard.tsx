import { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  color?: 'blue' | 'green' | 'red' | 'purple' | 'orange' | 'cyan' | 'teal' | 'gold' | 'rose' | 'sapphire' | 'emerald' | 'amber' | 'ruby' | 'pink';
  onClick?: () => void;
  className?: string;
}

export function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  color = 'purple',
  onClick,
  className
}: MetricCardProps) {
  // 이미지와 동일한 그라디언트 스타일
  const gradientClasses = {
    purple: 'bg-gradient-to-br from-purple-600/90 via-purple-700/90 to-purple-800/90',
    blue: 'bg-gradient-to-br from-blue-600/90 via-blue-700/90 to-blue-800/90',
    green: 'bg-gradient-to-br from-emerald-600/90 via-emerald-700/90 to-emerald-800/90',
    emerald: 'bg-gradient-to-br from-emerald-600/90 via-emerald-700/90 to-emerald-800/90',
    orange: 'bg-gradient-to-br from-orange-600/90 via-orange-700/90 to-orange-800/90',
    amber: 'bg-gradient-to-br from-amber-600/90 via-amber-700/90 to-amber-800/90',
    pink: 'bg-gradient-to-br from-pink-600/90 via-pink-700/90 to-pink-800/90',
    rose: 'bg-gradient-to-br from-rose-600/90 via-rose-700/90 to-rose-800/90',
    red: 'bg-gradient-to-br from-red-600/90 via-red-700/90 to-red-800/90',
    ruby: 'bg-gradient-to-br from-rose-600/90 via-rose-700/90 to-rose-800/90',
    cyan: 'bg-gradient-to-br from-cyan-600/90 via-cyan-700/90 to-cyan-800/90',
    teal: 'bg-gradient-to-br from-teal-600/90 via-teal-700/90 to-teal-800/90',
    sapphire: 'bg-gradient-to-br from-blue-600/90 via-blue-700/90 to-blue-800/90',
    gold: 'bg-gradient-to-br from-yellow-600/90 via-yellow-700/90 to-yellow-800/90'
  };

  return (
    <div 
      className={cn(
        "rounded-2xl p-6 relative overflow-hidden backdrop-blur-sm border border-white/10 shadow-xl transition-all duration-300 hover:shadow-2xl hover:scale-[1.02]",
        gradientClasses[color],
        onClick && "cursor-pointer",
        className
      )}
      onClick={onClick}
    >
      {/* 배경 패턴 */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent" />
      
      {/* 배경 아이콘 */}
      <div className="absolute -top-4 -right-4 opacity-[0.08]">
        <Icon className="h-32 w-32 text-white" />
      </div>

      {/* 콘텐츠 */}
      <div className="relative z-10">
        {/* 상단: 아이콘 + 타이틀 */}
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2.5 rounded-xl bg-white/15 backdrop-blur-md shadow-lg">
            <Icon className="h-6 w-6 text-white" />
          </div>
          <h3 className="font-semibold text-white/95 tracking-wide">
            {title}
          </h3>
        </div>

        {/* 중앙: 메인 값 (큰 숫자) */}
        <div className="mb-2">
          <p className="text-4xl font-extrabold text-white tracking-tight leading-none">
            {value}
          </p>
        </div>

        {/* 하단: 서브타이틀 */}
        {subtitle && (
          <p className="text-sm text-white/70 font-medium">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}
