import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// 숫자 포맷팅 (한국 원화)
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency: 'KRW',
    minimumFractionDigits: 0,
  }).format(amount);
}

// 숫자 포맷팅 (간단)
export function formatNumber(amount: number): string {
  return new Intl.NumberFormat('ko-KR').format(amount);
}

// 날짜 포맷팅
export function formatDate(date: string | Date, format: 'full' | 'date' | 'time' | 'datetime' = 'datetime'): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  
  switch (format) {
    case 'full':
      return d.toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    case 'date':
      return d.toLocaleDateString('ko-KR');
    case 'time':
      return d.toLocaleTimeString('ko-KR');
    case 'datetime':
      return d.toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    default:
      return d.toLocaleString('ko-KR');
  }
}

// 파트너 레벨 텍스트
export function getPartnerLevelText(level: number): string {
  const levels = {
    1: '시스템관리자',
    2: '대본사',
    3: '본사',
    4: '부본사',
    5: '총판',
    6: '매장',
  };
  return levels[level as keyof typeof levels] || '알 수 없음';
}

// 상태 텍스트
export function getStatusText(status: string): string {
  const statusMap = {
    active: '활성',
    inactive: '비활성',
    blocked: '차단',
    pending: '대기',
    approved: '승인',
    rejected: '거절',
    completed: '완료',
    visible: '노출',
    hidden: '숨김',
    maintenance: '점검중',
    unread: '읽지않음',
    read: '읽음',
    replied: '답변완료',
  };
  return statusMap[status as keyof typeof statusMap] || status;
}

// 트랜잭션 타입 텍스트
export function getTransactionTypeText(type: string): string {
  const typeMap = {
    deposit: '입금',
    withdrawal: '출금',
    point_conversion: '포인트전환',
    admin_adjustment: '관리자조정',
  };
  return typeMap[type as keyof typeof typeMap] || type;
}

// 상대 시간 (예: 2분 전)
export function getRelativeTime(date: string | Date): string {
  const now = new Date();
  const target = typeof date === 'string' ? new Date(date) : date;
  const diffMs = now.getTime() - target.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return '방금 전';
  if (diffMins < 60) return `${diffMins}분 전`;
  if (diffHours < 24) return `${diffHours}시간 전`;
  if (diffDays < 7) return `${diffDays}일 전`;
  return formatDate(target, 'date');
}

// 색상 클래스 (상태별)
export function getStatusColor(status: string): string {
  const colorMap = {
    active: 'text-green-600 bg-green-100',
    inactive: 'text-gray-600 bg-gray-100',
    blocked: 'text-red-600 bg-red-100',
    pending: 'text-yellow-600 bg-yellow-100',
    approved: 'text-blue-600 bg-blue-100',
    rejected: 'text-red-600 bg-red-100',
    completed: 'text-green-600 bg-green-100',
    visible: 'text-green-600 bg-green-100',
    hidden: 'text-gray-600 bg-gray-100',
    maintenance: 'text-orange-600 bg-orange-100',
  };
  return colorMap[status as keyof typeof colorMap] || 'text-gray-600 bg-gray-100';
}

// API 응답 처리
export function handleApiResponse<T>(response: any): { data: T | null; error: string | null } {
  if (response.success) {
    return { data: response.data, error: null };
  } else {
    return { data: null, error: response.error || '알 수 없는 오류가 발생했습니다.' };
  }
}

// 에러 메시지 처리
export function getErrorMessage(error: any): string {
  if (typeof error === 'string') return error;
  if (error?.message) return error.message;
  if (error?.error) return error.error;
  return '알 수 없는 오류가 발생했습니다.';
}

// 디바운스 함수
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

// 로컬 스토리지 유틸
export const storage = {
  get: (key: string) => {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : null;
    } catch {
      return null;
    }
  },
  set: (key: string, value: any) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Silent fail
    }
  },
  remove: (key: string) => {
    try {
      localStorage.removeItem(key);
    } catch {
      // Silent fail
    }
  },
};