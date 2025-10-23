import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { cn } from "../../lib/utils";
import { LucideIcon } from "lucide-react";
import { ReactNode } from "react";

interface UnifiedCardProps {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
  headerAction?: ReactNode;
  action?: ReactNode;
  variant?: 'default' | 'modern' | 'glass' | 'premium';
  icon?: LucideIcon;
  iconColor?: string;
}

/**
 * 통합 카드 컴포넌트 - AdminCard, PremiumSectionCard 통합
 * 메모리 최적화를 위해 하나의 컴포넌트로 재사용
 */
export function UnifiedCard({ 
  title, 
  description, 
  children, 
  className,
  headerAction,
  action,
  variant = 'modern',
  icon: Icon,
  iconColor = "text-cyan-400"
}: UnifiedCardProps) {
  const cardClasses = cn(
    "transition-all duration-300 border-0",
    {
      'glass-card': variant === 'default' || variant === 'glass',
      'admin-card-modern': variant === 'modern',
      'glass-card rounded-2xl border border-slate-700/50': variant === 'premium'
    },
    className
  );

  // Premium 변형 (PremiumSectionCard 스타일)
  if (variant === 'premium' && Icon) {
    return (
      <div className={cardClasses}>
        {/* 헤더 */}
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-700/50 px-6 pt-6">
          <div className={cn("p-2 rounded-lg bg-slate-800/50", iconColor.replace('text-', 'bg-') + '/20')}>
            <Icon className={cn("h-5 w-5", iconColor)} />
          </div>
          <h3 className="font-semibold text-slate-100">
            {title}
          </h3>
          {(headerAction || action) && (
            <div className="ml-auto flex items-center gap-3">
              {headerAction}
              {action}
            </div>
          )}
        </div>

        {/* 컨텐츠 */}
        <div className="space-y-3 px-6 pb-6">
          {children}
        </div>
      </div>
    );
  }

  // 기본 변형 (AdminCard 스타일)
  return (
    <Card className={cardClasses}>
      {(title || description || headerAction || action || Icon) && (
        <CardHeader className="pb-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {Icon && (
                <div className={cn("p-2 rounded-lg bg-slate-800/50", iconColor.replace('text-', 'bg-') + '/20')}>
                  <Icon className={cn("h-5 w-5", iconColor)} />
                </div>
              )}
              <div className="space-y-1.5">
                {title && (
                  <CardTitle className="text-xl font-bold text-slate-100">
                    {title}
                  </CardTitle>
                )}
                {description && (
                  <CardDescription className="text-base text-slate-400">
                    {description}
                  </CardDescription>
                )}
              </div>
            </div>
            {(headerAction || action) && (
              <div className="flex items-center gap-3">
                {headerAction}
                {action}
              </div>
            )}
          </div>
        </CardHeader>
      )}
      <CardContent className={title || description || headerAction || action || Icon ? "pt-0" : "pt-7"}>
        {children}
      </CardContent>
    </Card>
  );
}

// SectionRow 컴포넌트도 여기에 포함 (재사용)
interface SectionRowProps {
  label: string;
  value: string | number;
  valueColor?: string;
  badge?: string;
  badgeColor?: string;
  icon?: LucideIcon;
  iconColor?: string;
}

export function SectionRow({
  label,
  value,
  valueColor = "text-cyan-400",
  badge,
  badgeColor = "bg-cyan-500/20 text-cyan-400",
  icon: Icon,
  iconColor = "text-slate-400"
}: SectionRowProps) {
  return (
    <div className="flex items-center justify-between py-3 px-4 rounded-lg bg-slate-800/30 hover:bg-slate-800/50 transition-colors">
      <div className="flex items-center gap-3">
        {Icon && (
          <div className={cn("p-1.5 rounded-lg bg-slate-700/50", iconColor)}>
            <Icon className="h-4 w-4" />
          </div>
        )}
        <span className="text-slate-300 font-medium">
          {label}
        </span>
      </div>
      <div className="flex items-center gap-3">
        {badge && (
          <span className={cn("px-2.5 py-1 rounded-full text-xs font-semibold", badgeColor)}>
            {badge}
          </span>
        )}
        <span className={cn("font-bold text-lg", valueColor)}>
          {value}
        </span>
      </div>
    </div>
  );
}
