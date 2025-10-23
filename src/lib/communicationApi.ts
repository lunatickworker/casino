import { supabase } from './supabase';

// 고객센터 API 함수들
export const customerSupportApi = {
  // 고객 문의 목록 조회
  async getInquiries(filters?: {
    status?: string;
    category?: string;
    priority?: string;
    search?: string;
  }) {
    let query = supabase
      .from('customer_inquiries')
      .select(`
        *,
        users!inner(username),
        admin:admin_id(username)
      `)
      .order('created_at', { ascending: false });

    if (filters?.status && filters.status !== 'all') {
      query = query.eq('status', filters.status);
    }
    
    if (filters?.category && filters.category !== 'all') {
      query = query.eq('category', filters.category);
    }
    
    if (filters?.priority && filters.priority !== 'all') {
      query = query.eq('priority', filters.priority);
    }
    
    if (filters?.search) {
      query = query.or(`title.ilike.%${filters.search}%,content.ilike.%${filters.search}%,users.username.ilike.%${filters.search}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  // 문의 상태 업데이트
  async updateInquiryStatus(inquiryId: string, status: string) {
    const { error } = await supabase
      .from('customer_inquiries')
      .update({ status })
      .eq('id', inquiryId);

    if (error) throw error;
  },

  // 문의에 답변 작성
  async respondToInquiry(
    inquiryId: string, 
    adminId: string, 
    response: string
  ) {
    const { error } = await supabase
      .from('customer_inquiries')
      .update({
        admin_response: response,
        admin_id: adminId,
        status: 'completed',
        responded_at: new Date().toISOString()
      })
      .eq('id', inquiryId);

    if (error) throw error;
  }
};

// 공지사항 API 함수들
export const announcementsApi = {
  // 공지사항 목록 조회
  async getAnnouncements(filters?: {
    status?: string;
    target_audience?: string;
    search?: string;
  }) {
    let query = supabase
      .from('announcements')
      .select(`
        *,
        partners!announcements_partner_id_fkey(username)
      `)
      .order('display_order', { ascending: false })
      .order('created_at', { ascending: false });

    if (filters?.status && filters.status !== 'all') {
      query = query.eq('status', filters.status);
    }
    
    if (filters?.target_audience && filters.target_audience !== 'all') {
      query = query.eq('target_audience', filters.target_audience);
    }
    
    if (filters?.search) {
      query = query.or(`title.ilike.%${filters.search}%,content.ilike.%${filters.search}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  // 공지사항 생성
  async createAnnouncement(announcementData: {
    partner_id: string;
    title: string;
    content: string;
    image_url?: string;
    is_popup: boolean;
    target_audience: string;
    target_level?: number;
    status: string;
    display_order: number;
    start_date?: string;
    end_date?: string;
  }) {
    const { data, error } = await supabase
      .from('announcements')
      .insert([{
        ...announcementData,
        start_date: announcementData.start_date || new Date().toISOString(),
        end_date: announcementData.end_date || null
      }])
      .select();

    if (error) throw error;
    return data;
  },

  // 공지사항 수정
  async updateAnnouncement(announcementId: string, updateData: any) {
    const { data, error } = await supabase
      .from('announcements')
      .update(updateData)
      .eq('id', announcementId)
      .select();

    if (error) throw error;
    return data;
  },

  // 공지사항 삭제
  async deleteAnnouncement(announcementId: string) {
    const { error } = await supabase
      .from('announcements')
      .delete()
      .eq('id', announcementId);

    if (error) throw error;
  },

  // 공지사항 상태 변경
  async updateAnnouncementStatus(announcementId: string, status: string) {
    const { error } = await supabase
      .from('announcements')
      .update({ status })
      .eq('id', announcementId);

    if (error) throw error;
  },

  // 공지사항 조회수 증가
  async incrementViewCount(announcementId: string) {
    const { error } = await supabase.rpc('increment_announcement_view_count', {
      announcement_id: announcementId
    });

    if (error) throw error;
  }
};

// 메시지 센터 API 함수들
export const messageCenterApi = {
  // 메시지 목록 조회 (받은 메시지/보낸 메시지)
  async getMessages(
    userId: string,
    messageType: 'received' | 'sent',
    filters?: {
      message_type?: string;
      is_read?: boolean;
      search?: string;
    }
  ) {
    let query = supabase
      .from('messages')
      .select('*')
      .order('created_at', { ascending: false });

    // 받은 메시지 / 보낸 메시지 필터
    if (messageType === 'received') {
      query = query
        .eq('recipient_type', 'partner')
        .eq('recipient_id', userId);
    } else {
      query = query
        .eq('sender_type', 'partner')
        .eq('sender_id', userId);
    }

    if (filters?.message_type && filters.message_type !== 'all') {
      query = query.eq('message_type', filters.message_type);
    }
    
    if (filters?.is_read !== undefined) {
      query = query.eq('is_read', filters.is_read);
    }
    
    if (filters?.search) {
      query = query.or(`title.ilike.%${filters.search}%,content.ilike.%${filters.search}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    // 사용자 정보를 별도로 조회하여 메시지에 추가
    const messagesWithUserInfo = await Promise.all(
      (data || []).map(async (message: any) => {
        // 발신자 정보 조회
        let senderUsername = '알 수 없음';
        if (message.sender_type === 'user') {
          const { data: senderData } = await supabase
            .from('users')
            .select('username')
            .eq('id', message.sender_id)
            .maybeSingle();
          senderUsername = senderData?.username || '사용자';
        } else if (message.sender_type === 'partner') {
          const { data: senderData } = await supabase
            .from('partners')
            .select('username')
            .eq('id', message.sender_id)
            .maybeSingle();
          senderUsername = senderData?.username || '관리자';
        }

        // 수신자 정보 조회
        let recipientUsername = '알 수 없음';
        if (message.recipient_type === 'user') {
          const { data: recipientData } = await supabase
            .from('users')
            .select('username')
            .eq('id', message.recipient_id)
            .maybeSingle();
          recipientUsername = recipientData?.username || '사용자';
        } else if (message.recipient_type === 'partner') {
          const { data: recipientData } = await supabase
            .from('partners')
            .select('username')
            .eq('id', message.recipient_id)
            .maybeSingle();
          recipientUsername = recipientData?.username || '관리자';
        }

        return {
          ...message,
          sender_username: senderUsername,
          recipient_username: recipientUsername
        };
      })
    );

    return messagesWithUserInfo;
  },

  // 메시지 전송
  async sendMessage(messageData: {
    sender_type: string;
    sender_id: string;
    recipient_type: string;
    recipient_id: string;
    title?: string;
    content: string;
    message_type: string;
    parent_message_id?: string;
  }) {
    const { data, error } = await supabase
      .from('messages')
      .insert([messageData])
      .select();

    if (error) throw error;
    return data;
  },

  // 브로드캐스트 메시지 전송 (선택 또는 전체)
  async sendBroadcastMessage(
    senderType: string,
    senderId: string,
    recipientType: 'user' | 'partner',
    broadcastType: 'selected' | 'all',
    messageData: {
      title?: string;
      content: string;
      message_type: string;
      selected_usernames?: string[];
    }
  ) {
    let recipients: any[] = [];
    const table = recipientType === 'user' ? 'users' : 'partners';

    if (broadcastType === 'selected' && messageData.selected_usernames) {
      // 선택된 사용자들 조회
      const { data, error } = await supabase
        .from(table)
        .select('id, username')
        .in('username', messageData.selected_usernames);
      
      if (error) throw error;
      recipients = data || [];
    } else if (broadcastType === 'all') {
      // 모든 사용자 조회
      const { data, error } = await supabase
        .from(table)
        .select('id, username');
      
      if (error) throw error;
      recipients = data || [];
    }

    if (recipients.length === 0) {
      throw new Error('전송할 수신자가 없습니다.');
    }

    // 메시지 데이터 준비
    const messagesData = recipients.map(recipient => ({
      sender_type: senderType,
      sender_id: senderId,
      recipient_type: recipientType,
      recipient_id: recipient.id,
      title: messageData.title || null,
      content: messageData.content,
      message_type: messageData.message_type
    }));

    // 배치 전송
    const { data, error } = await supabase
      .from('messages')
      .insert(messagesData)
      .select();

    if (error) throw error;
    return { data, recipientCount: recipients.length, recipients };
  },

  // 메시지 읽음 처리
  async markAsRead(messageId: string) {
    const { error } = await supabase
      .from('messages')
      .update({ 
        is_read: true, 
        read_at: new Date().toISOString() 
      })
      .eq('id', messageId)
      .eq('is_read', false);

    if (error) throw error;
  },

  // 답글 수 조회
  async getReplyCount(messageId: string) {
    const { count, error } = await supabase
      .from('messages')
      .select('*', { count: 'exact' })
      .eq('parent_message_id', messageId);

    if (error) throw error;
    return count || 0;
  },

  // 수신자 조회 (사용자 또는 관리자)
  async findRecipient(recipientType: 'user' | 'partner', username: string) {
    const table = recipientType === 'user' ? 'users' : 'partners';
    
    const { data, error } = await supabase
      .from(table)
      .select('id')
      .eq('username', username.trim())
      .maybeSingle();

    if (error) throw error;
    return data;
  }
};

// 알림 API 함수들
export const notificationsApi = {
  // 알림 목록 조회
  async getNotifications(
    recipientType: string,
    recipientId: string,
    filters?: {
      notification_type?: string;
      is_read?: boolean;
    }
  ) {
    let query = supabase
      .from('notifications')
      .select('*')
      .eq('recipient_type', recipientType)
      .eq('recipient_id', recipientId)
      .order('created_at', { ascending: false });

    if (filters?.notification_type) {
      query = query.eq('notification_type', filters.notification_type);
    }
    
    if (filters?.is_read !== undefined) {
      query = query.eq('is_read', filters.is_read);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  // 알림 생성
  async createNotification(notificationData: {
    recipient_type: string;
    recipient_id: string;
    notification_type: string;
    title: string;
    content?: string;
    data?: any;
  }) {
    const { data, error } = await supabase
      .from('notifications')
      .insert([notificationData])
      .select();

    if (error) throw error;
    return data;
  },

  // 알림 읽음 처리
  async markAsRead(notificationId: string) {
    const { error } = await supabase
      .from('notifications')
      .update({ 
        is_read: true, 
        read_at: new Date().toISOString() 
      })
      .eq('id', notificationId);

    if (error) throw error;
  },

  // 모든 알림 읽음 처리
  async markAllAsRead(recipientType: string, recipientId: string) {
    const { error } = await supabase
      .from('notifications')
      .update({ 
        is_read: true, 
        read_at: new Date().toISOString() 
      })
      .eq('recipient_type', recipientType)
      .eq('recipient_id', recipientId)
      .eq('is_read', false);

    if (error) throw error;
  }
};

// 통합 커뮤니케이션 API
export const communicationApi = {
  customerSupport: customerSupportApi,
  announcements: announcementsApi,
  messageCenter: messageCenterApi,
  notifications: notificationsApi
};