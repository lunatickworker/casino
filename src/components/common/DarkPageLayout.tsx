import { ReactNode } from "react";
import { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";

interface DarkPageLayoutProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function DarkPageLayout({
  title,
  description,
  icon: Icon,
  actions,
  children,
  className
}: DarkPageLayoutProps) {
  return (
    <div className={cn("space-y-6", className)}>
      {/* 페이지 헤더 */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            {Icon && (
              <div className="p-2 rounded-lg bg-blue-500/20">
                <Icon className="h-6 w-6 text-blue-400" />
              </div>
            )}
            <h1 className="text-2xl font-bold text-slate-100">{title}</h1>
          </div>
          {description && (
            <p className="text-sm text-slate-400 ml-14">{description}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>

      {/* 페이지 콘텐츠 */}
      {children}
    </div>
  );
}

// 다크 스타일 카드 래퍼
interface DarkCardProps {
  children: ReactNode;
  className?: string;
  title?: string;
  description?: string;
  actions?: ReactNode;
}

export function DarkCard({ children, className, title, description, actions }: DarkCardProps) {
  return (
    <div className={cn("glass-card rounded-xl p-6", className)}>
      {(title || description || actions) && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            {title && <h3 className="font-semibold text-slate-100">{title}</h3>}
            {actions}
          </div>
          {description && <p className="text-sm text-slate-400">{description}</p>}
        </div>
      )}
      {children}
    </div>
  );
}

// 다크 스타일 통계 그리드
interface DarkStatsGridProps {
  children: ReactNode;
  columns?: 2 | 3 | 4;
  className?: string;
}

export function DarkStatsGrid({ children, columns = 4, className }: DarkStatsGridProps) {
  const gridCols = {
    2: "md:grid-cols-2",
    3: "md:grid-cols-3",
    4: "md:grid-cols-2 lg:grid-cols-4"
  };

  return (
    <div className={cn("grid gap-5", gridCols[columns], className)}>
      {children}
    </div>
  );
}

// 다크 스타일 리스트 아이템
interface DarkListItemProps {
  label: string;
  value: ReactNode;
  color?: "default" | "cyan" | "amber" | "rose" | "emerald";
  highlight?: boolean;
  badge?: ReactNode;
  className?: string;
}

export function DarkListItem({ 
  label, 
  value, 
  color = "default",
  highlight = false,
  badge,
  className 
}: DarkListItemProps) {
  const colorClasses = {
    default: "bg-slate-800/50",
    cyan: "text-cyan-400",
    amber: "text-amber-400",
    rose: "text-rose-400",
    emerald: "text-emerald-400"
  };

  const dotColors = {
    default: "bg-slate-400",
    cyan: "bg-cyan-400",
    amber: "bg-amber-400",
    rose: "bg-rose-400",
    emerald: "bg-emerald-400"
  };

  return (
    <div 
      className={cn(
        "flex items-center justify-between p-3 rounded-lg transition-colors",
        highlight 
          ? `bg-${color === "default" ? "cyan" : color}-500/10 border border-${color === "default" ? "cyan" : color}-500/30`
          : "bg-slate-800/50 hover:bg-slate-800/70",
        className
      )}
    >
      <div className="flex items-center gap-3">
        <div className={cn("w-2 h-2 rounded-full", dotColors[color])}></div>
        <span className={cn(
          "text-sm",
          highlight ? "text-slate-100 font-medium" : "text-slate-300"
        )}>
          {label}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className={cn(
          "font-semibold",
          highlight ? "font-bold" : "",
          color !== "default" ? colorClasses[color] : "text-slate-200"
        )}>
          {value}
        </span>
        {badge}
      </div>
    </div>
  );
}
