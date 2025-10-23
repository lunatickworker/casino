// 공통 타입 정의
export interface User {
  id: string;
  username: string;
  nickname: string;
  status: 'pending' | 'active' | 'blocked';
  balance: number;
  points: number;
  referrer_id?: string;
  vip_level: number;
  is_online: boolean;
  last_login_at?: string;
  created_at: string;
}

export interface Partner {
  id: string;
  username: string;
  nickname: string;
  name?: string;
  partner_type: 'system_admin' | 'head_office' | 'main_office' | 'sub_office' | 'distributor' | 'store';
  level: number; // 1-6
  parent_id?: string;
  parent_chain?: string[];
  status: 'active' | 'inactive' | 'blocked';
  balance: number;
  opcode?: string;
  secret_key?: string;
  token?: string;
  api_token?: string;
  commission_rolling: number;
  commission_losing: number;
  withdrawal_fee: number;
  last_login_at?: string;
  created_at: string;
}

export interface Transaction {
  id: string;
  user_id: string;
  partner_id?: string;
  transaction_type: 'deposit' | 'withdrawal' | 'point_conversion' | 'admin_adjustment' | 'admin_deposit' | 'admin_withdrawal';
  amount: number;
  status: 'pending' | 'approved' | 'rejected' | 'completed';
  balance_before: number;
  balance_after: number;
  bank_name?: string;
  bank_account?: string;
  bank_holder?: string;
  memo?: string;
  processed_at?: string;
  external_response?: any;
  created_at: string;
  updated_at: string;
  user?: {
    id: string;
    username: string;
    nickname: string;
    external_token?: string;
  };
  owner_partner?: {
    id: string;
    nickname: string;
    level: number;
  };
  processed_partner?: {
    id: string;
    nickname: string;
    level: number;
  };
}

export interface Settlement {
  id: string;
  partner_id: string;
  settlement_type: 'rolling' | 'losing';
  period_start: string;
  period_end: string;
  total_bet_amount: number;
  total_win_amount: number;
  commission_rate: number;
  commission_amount: number;
  status: 'pending' | 'completed';
  processed_at?: string;
  created_at: string;
  partner?: {
    id: string;
    nickname: string;
    level: number;
  };
}

export interface GameRecord {
  id: string;
  external_txid: number;
  user_id: string;
  game_id: number;
  provider_id: number;
  bet_amount: number;
  win_amount: number;
  balance_before: number;
  balance_after: number;
  played_at: string;
  created_at: string;
}

export interface Message {
  id: string;
  sender_type: 'user' | 'partner';
  sender_id: string;
  receiver_type: 'user' | 'partner';
  receiver_id: string;
  subject?: string;
  content: string;
  message_type: 'inquiry' | 'notice' | 'message';
  status: 'unread' | 'read' | 'replied';
  parent_id?: string;
  read_at?: string;
  created_at: string;
}

export interface Announcement {
  id: string;
  partner_id: string;
  title: string;
  content: string;
  target_type: 'users' | 'partners' | 'all';
  target_level?: number;
  is_popup: boolean;
  is_pinned: boolean;
  status: 'active' | 'inactive';
  view_count: number;
  created_at: string;
}

export interface DashboardStats {
  total_users: number;
  total_balance: number;
  daily_deposit: number;
  daily_withdrawal: number;
  daily_net_deposit: number;
  casino_betting: number;
  slot_betting: number;
  total_betting: number;
  online_users: number;
  pending_approvals: number;
  pending_messages: number;
  pending_deposits: number;
  pending_withdrawals: number;
}

export interface AuthState {
  isAuthenticated: boolean;
  user: Partner | null;
  token: string | null;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface GameProvider {
  id: number;
  name: string;
  type: 'slot' | 'casino';
  status: 'active' | 'inactive' | 'maintenance';
  logo_url?: string;
}

export interface Game {
  id: number;
  provider_id: number;
  name: string;
  type: 'slot' | 'casino';
  status: 'visible' | 'hidden' | 'maintenance';
  image_url?: string;
  demo_available: boolean;
}