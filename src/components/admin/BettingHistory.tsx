import { useState, useEffect } from "react";
import { CreditCard, Download, AlertCircle, CloudDownload } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Badge } from "../ui/badge";
import { DataTable } from "../common/DataTable";
import { LoadingSpinner } from "../common/LoadingSpinner";
import { Label } from "../ui/label";
import { toast } from "sonner@2.0.3";
import { Partner } from "../../types";
import { supabase } from "../../lib/supabase";
import { MetricCard } from "./MetricCard";
import * as investApi from "../../lib/investApi";

interface BettingHistoryProps {
  user: Partner;
}

interface BettingRecord {
  id: string;
  external_txid: string | number;
  username: string;
  user_id: string | null;
  game_id: number;
  provider_id: number;
  game_title?: string;
  provider_name?: string;
  bet_amount: number;
  win_amount: number;
  balance_before: number;
  balance_after: number;
  played_at: string;
}

export function BettingHistory({ user }: BettingHistoryProps) {
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [bettingRecords, setBettingRecords] = useState<BettingRecord[]>([]);
  const [dateFilter, setDateFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  
  const [stats, setStats] = useState({
    totalBets: 0,
    totalBetAmount: 0,
    totalWinAmount: 0,
    netProfit: 0
  });

  // 날짜 포맷
  const formatKoreanDate = (dateStr: string) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const seconds = String(date.getUTCSeconds()).padStart(2, '0');
    
    return `${year}년${month}월${day}일 ${hours}:${minutes}:${seconds}`;
  };

  // 날짜 범위 계산
  const getDateRange = (filter: string) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    switch (filter) {
      case 'today':
        return { start: today.toISOString(), end: now.toISOString() };
      case 'week':
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - 7);
        return { start: weekStart.toISOString(), end: now.toISOString() };
      case 'month':
        const monthStart = new Date(today);
        monthStart.setMonth(today.getMonth() - 1);
        return { start: monthStart.toISOString(), end: now.toISOString() };
      default:
        // "all" 선택시에는 날짜 필터 없음
        return null;
    }
  };

  // 데이터 로드 - 모든 필터 제거
  const loadBettingData = async () => {
    try {
      console.log('🔄 베팅 데이터 로드 시작');
      setLoading(true);
      
      const dateRange = getDateRange(dateFilter);

      // ✅ 권한별 하위 파트너 ID 목록 조회
      let allowedPartnerIds: string[] = [];
      
      if (user.level === 1) {
        // 시스템관리자: 모든 파트너
        const { data: allPartners } = await supabase
          .from('partners')
          .select('id');
        allowedPartnerIds = allPartners?.map(p => p.id) || [];
      } else {
        // 하위 파트너만 (자신 포함)
        allowedPartnerIds = [user.id];
        
        // 1단계 하위
        const { data: level1 } = await supabase
          .from('partners')
          .select('id')
          .eq('parent_id', user.id);
        
        const level1Ids = level1?.map(p => p.id) || [];
        allowedPartnerIds.push(...level1Ids);
        
        if (level1Ids.length > 0) {
          // 2단계 하위
          const { data: level2 } = await supabase
            .from('partners')
            .select('id')
            .in('parent_id', level1Ids);
          
          const level2Ids = level2?.map(p => p.id) || [];
          allowedPartnerIds.push(...level2Ids);
          
          if (level2Ids.length > 0) {
            // 3단계 하위
            const { data: level3 } = await supabase
              .from('partners')
              .select('id')
              .in('parent_id', level2Ids);
            
            const level3Ids = level3?.map(p => p.id) || [];
            allowedPartnerIds.push(...level3Ids);
            
            if (level3Ids.length > 0) {
              // 4단계 하위
              const { data: level4 } = await supabase
                .from('partners')
                .select('id')
                .in('parent_id', level3Ids);
              
              const level4Ids = level4?.map(p => p.id) || [];
              allowedPartnerIds.push(...level4Ids);
              
              if (level4Ids.length > 0) {
                // 5단계 하위
                const { data: level5 } = await supabase
                  .from('partners')
                  .select('id')
                  .in('parent_id', level4Ids);
                
                const level5Ids = level5?.map(p => p.id) || [];
                allowedPartnerIds.push(...level5Ids);
              }
            }
          }
        }
      }
      
      console.log('👥 하위 파트너 ID 개수:', allowedPartnerIds.length);

      // ✅ 해당 파트너들의 회원 ID 목록 조회
      let userIds: string[] = [];
      
      if (allowedPartnerIds.length > 0) {
        const { data: usersData } = await supabase
          .from('users')
          .select('id')
          .in('referrer_id', allowedPartnerIds);
        
        userIds = usersData?.map(u => u.id) || [];
        console.log('👤 하위 회원 ID 개수:', userIds.length);
      }
      
      // 쿼리 빌더 시작 - 하위 회원만 조회
      let query = supabase
        .from('game_records')
        .select('*');

      // ✅ 하위 회원 필터링
      if (userIds.length > 0) {
        query = query.in('user_id', userIds);
      } else {
        // 하위 회원이 없으면 빈 결과 반환
        setBettingRecords([]);
        setStats({
          totalBets: 0,
          totalBetAmount: 0,
          totalWinAmount: 0,
          netProfit: 0
        });
        setLoading(false);
        return;
      }
      
      // 날짜 필터가 있을 때만 적용
      if (dateRange) {
        query = query
          .gte('played_at', dateRange.start)
          .lte('played_at', dateRange.end);
      }
      
      // 정렬 및 제한
      query = query
        .order('played_at', { ascending: false })
        .limit(1000);

      const { data, error } = await query;

      if (error) {
        console.error('❌ 베팅 데이터 로드 실패:', error);
        throw error;
      }

      console.log('✅ 베팅 데이터 로드 성공:', data?.length || 0, '건');
      console.log('📊 첫 번째 레코드:', data?.[0]);
      
      // 데이터 상태 업데이트
      setBettingRecords(data || []);

      // 통계 계산
      if (data && data.length > 0) {
        const totalBetAmount = data.reduce((sum, r) => sum + parseFloat(r.bet_amount?.toString() || '0'), 0);
        const totalWinAmount = data.reduce((sum, r) => sum + parseFloat(r.win_amount?.toString() || '0'), 0);

        setStats({
          totalBets: data.length,
          totalBetAmount,
          totalWinAmount,
          netProfit: totalWinAmount - totalBetAmount
        });
      } else {
        setStats({
          totalBets: 0,
          totalBetAmount: 0,
          totalWinAmount: 0,
          netProfit: 0
        });
      }
    } catch (error) {
      console.error('❌ 베팅 데이터 로드 오류:', error);
      toast.error('베팅 데이터를 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 비상시 수동 API 동기화 (세션과 무관하게 무조건 API 호출)
  const manualSyncFromApi = async () => {
    try {
      setSyncing(true);
      toast.info('베팅 기록 API를 호출하여 업데이트합니다...');
      
      const now = new Date();
      const year = now.getFullYear().toString();
      const month = (now.getMonth() + 1).toString();

      console.log('🎲 베팅 데이터 수동 동기화 시작', { year, month });

      // 시스템의 모든 파트너 OPCODE 조회 (세션 상관없이)
      const { data: partners, error: partnersError } = await supabase
        .from("partners")
        .select("id, opcode, secret_key, api_token")
        .not("opcode", "is", null)
        .not("secret_key", "is", null);

      if (partnersError || !partners || partners.length === 0) {
        toast.warning('API 설정이 있는 파트너가 없습니다.');
        return;
      }

      toast.info(`${partners.length}개 파트너의 베팅 데이터를 동기화 중...`);
      
      let totalRecordsProcessed = 0;

      // 각 파트너별로 베팅 데이터 조회
      for (const partner of partners) {
        try {
          console.log(`📊 파트너 ${partner.id} (${partner.opcode}) 베팅 데이터 조회 시작`);
          
          // game/historyindex API 호출
          const result = await investApi.getGameHistory(
            partner.opcode,
            year,
            month,
            0,
            4000,
            partner.secret_key
          );

          if (result.error) {
            console.error(`❌ 파트너 ${partner.id} 베팅 데이터 조회 실패:`, result.error);
            continue;
          }

          // API 응답 직접 파싱
          let bettingRecords: any[] = [];
          
          if (result.data) {
            if (!result.data.is_text) {
              if (result.data.RESULT === true && Array.isArray(result.data.DATA)) {
                bettingRecords = result.data.DATA;
              } else if (Array.isArray(result.data.DATA)) {
                bettingRecords = result.data.DATA;
              } else if (Array.isArray(result.data)) {
                bettingRecords = result.data;
              }
            } else if (result.data.is_text && result.data.text_response) {
              try {
                const parsed = JSON.parse(result.data.text_response);
                if (Array.isArray(parsed.DATA)) {
                  bettingRecords = parsed.DATA;
                } else if (Array.isArray(parsed)) {
                  bettingRecords = parsed;
                }
              } catch (e) {
                console.warn('텍스트 응답 파싱 실패:', e);
              }
            }
          }

          if (bettingRecords.length === 0) {
            console.log(`⏭️ 파트너 ${partner.id}: 베팅 데이터 없음`);
            continue;
          }

          console.log(`✅ 파트너 ${partner.id}: ${bettingRecords.length}건 베팅 데이터 조회`);
          totalRecordsProcessed += bettingRecords.length;
          
          // 사용자별 최신 보유금 추출
          const userBalances = new Map<string, number>();
          const uniqueUsernames = new Set<string>();
          
          bettingRecords.forEach((record: any) => {
            if (record.username && record.balance !== undefined) {
              userBalances.set(record.username, record.balance);
              uniqueUsernames.add(record.username);
            }
          });

          console.log(`📊 고유 사용자 수: ${uniqueUsernames.size}명 (${Array.from(uniqueUsernames).join(', ')})`);

          // 사용자 보유금 업데이트 (Active 세션 체크)
          console.log(`🔍 ${uniqueUsernames.size}명의 사용자 보유금 업데이트 시작...`);
          
          for (const [username, balance] of userBalances) {
            // 1️⃣ 먼저 사용자 ID 조회
            const { data: userData, error: userError } = await supabase
              .from('users')
              .select('id, referrer_id')
              .eq('username', username)
              .maybeSingle();

            if (userError) {
              console.error(`❌ 사용자 ${username} 조회 오류:`, userError);
              continue;
            }

            if (!userData) {
              // 실제로 존재하는지 확인 (referrer_id 조건 없이)
              const { data: anyUser } = await supabase
                .from('users')
                .select('id, referrer_id, username')
                .eq('username', username)
                .maybeSingle();
              
              if (anyUser) {
                console.debug(`ℹ️ 사용자 ${username}는 다른 파트너(${anyUser.referrer_id}) 소속 (건너뜀)`);
              } else {
                console.debug(`ℹ️ 사용자 ${username}는 DB에 미등록 (건너뜀)`);
              }
              continue;
            }

            // 현재 파트너 소속인지 확인 (이미 위에서 체크되었지만 안전장치)
            if (userData.referrer_id !== partner.id) {
              console.debug(`ℹ️ 사용자 ${username}는 다른 파트너 소속 (건너뜀)`);
              continue;
            }

            // 2️⃣ Active 세션 확인
            const { data: activeSession, error: sessionError } = await supabase
              .from('game_launch_sessions')
              .select('id')
              .eq('user_id', userData.id)
              .eq('status', 'active')
              .limit(1)
              .single();

            if (sessionError && sessionError.code !== 'PGRST116') {
              console.error(`❌ 세션 조회 오류 (${username}):`, sessionError);
              continue;
            }

            // 3️⃣ Active 세션이 있는 경우에만 보유금 업데이트
            if (activeSession) {
              const { error: updateError } = await supabase
                .from('users')
                .update({ balance: balance })
                .eq('id', userData.id);

              if (updateError) {
                console.error(`❌ 사용자 ${username} 잔고 업데이트 실패:`, updateError);
              } else {
                console.log(`💰 [Active Session] 사용자 ${username} 잔고 업데이트: ${balance}`);
              }
            } else {
              console.log(`⛔ [No Active Session] 사용자 ${username} 잔고 업데이트 스킵 (session 없음 또는 ended)`);
            }
          }

          // 베팅 기록을 DB에 저장
          console.log(`💾 파트너 ${partner.id}: DB 저장 시작 (${bettingRecords.length}건)`);
          
          let savedCount = 0;
          
          for (const record of bettingRecords) {
            try {
              // 1. username으로 user_id 조회
              const { data: userData, error: userError } = await supabase
                .from('users')
                .select('id, referrer_id')
                .eq('username', record.username)
                .maybeSingle();

              if (userError) {
                console.error(`❌ 사용자 조회 오류 (${record.username}):`, userError);
                skippedCount++;
                continue;
              }

              if (!userData) {
                console.debug(`ℹ️ 사용자 ${record.username}는 DB에 미등록 (건너뜀)`);
                skippedCount++;
                continue;
              }

              // 현재 파트너 소속인지 확인
              if (userData.referrer_id !== partner.id) {
                console.debug(`ℹ️ 사용자 ${record.username}는 다른 파트너 소속 (건너뜀)`);
                skippedCount++;
                continue;
              }

              const externalTxid = (record.id || record.txid)?.toString();
              if (!externalTxid) {
                console.warn(`⚠️ external_txid 없음:`, record);
                continue;
              }

              // 2. 중복 체크
              const { data: existing, error: existError } = await supabase
                .from('game_records')
                .select('id')
                .eq('external_txid', externalTxid)
                .eq('partner_id', partner.id)
                .maybeSingle();

              if (existError) {
                console.error(`❌ 중복 체크 오류 (${externalTxid}):`, existError);
                continue;
              }

              if (existing) {
                // 중복이면 건너뜀
                continue;
              }

              // 3. 새 레코드 insert
              const betAmount = parseFloat(record.bet || record.bet_amount || '0');
              const winAmount = parseFloat(record.win || record.win_amount || '0');
              const balanceAfter = parseFloat(record.balance || record.balance_after || '0');
              
              // balance_before 계산: balance_after - (win_amount - bet_amount)
              const balanceBefore = balanceAfter - (winAmount - betAmount);
              
              const gameRecord = {
                partner_id: partner.id,
                external_txid: externalTxid,
                username: record.username,
                user_id: userData.id,
                game_id: record.game || record.game_id,
                provider_id: Math.floor((record.game || record.game_id) / 1000),
                game_title: record.game_title || null,
                provider_name: record.provider_name || null,
                bet_amount: betAmount,
                win_amount: winAmount,
                balance_before: balanceBefore,
                balance_after: balanceAfter,
                played_at: record.create_at || record.played_at || record.created_at || new Date().toISOString()
              };

              console.log(`💾 INSERT 시도: txid=${externalTxid}, user=${record.username}`);

              const { data: insertData, error: insertError } = await supabase
                .from('game_records')
                .insert(gameRecord)
                .select();

              if (insertError) {
                console.error(`❌ INSERT 실패 (${externalTxid}):`, insertError);
                console.error('실패한 데이터:', gameRecord);
              } else {
                console.log(`✅ INSERT 성공: ${externalTxid} (${record.username})`);
                savedCount++;
              }
            } catch (err) {
              console.error(`❌ 레코드 처리 예외:`, err, record);
            }
          }
          
          console.log(`📊 파트너 ${partner.id}: DB 저장 완료 (성공: ${savedCount}, 건너뜀: ${skippedCount}, 전체: ${bettingRecords.length})`);

        } catch (error) {
          console.error(`❌ 파트너 ${partner.id} 처리 중 오류:`, error);
        }
      }
      
      // 동기화 후 데이터 재로드
      await loadBettingData();
      toast.success(`베팅 기록 업데이트 완료 (${totalRecordsProcessed}건 처리)`);
      
    } catch (error) {
      console.error('❌ 베팅 기록 업데이트 오류:', error);
      toast.error('베팅 기록 업데이트에 실패했습니다.');
    } finally {
      setSyncing(false);
    }
  };

  // CSV 다운로드
  const downloadExcel = () => {
    try {
      const csvContent = [
        ['TX ID', '사용자', '게임명', '제공사', '베팅액', '당첨액', '베팅전금액', '베팅후금액', '손익', '플레이 시간'].join(','),
        ...filteredRecords.map(record => {
          const profitLoss = parseFloat(record.win_amount?.toString() || '0') - parseFloat(record.bet_amount?.toString() || '0');
          return [
            record.external_txid,
            record.username,
            record.game_title || `Game ${record.game_id}`,
            record.provider_name || `Provider ${record.provider_id}`,
            record.bet_amount,
            record.win_amount,
            record.balance_before,
            record.balance_after,
            profitLoss,
            formatKoreanDate(record.played_at)
          ].join(',');
        })
      ].join('\n');

      const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `betting_history_${dateFilter}_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      toast.success('베팅 내역 다운로드 완료');
    } catch (error) {
      console.error('다운로드 오류:', error);
      toast.error('다운로드 실패');
    }
  };

  // 초기 로드
  useEffect(() => {
    loadBettingData();
  }, [dateFilter]);

  // Realtime 구독
  useEffect(() => {
    console.log('🔌 Realtime 구독 시작');
    
    const channel = supabase
      .channel('betting-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'game_records'
        },
        (payload) => {
          console.log('🎲 베팅 데이터 변경 감지:', payload);
          // 즉시 데이터 재로드
          loadBettingData();
        }
      )
      .subscribe((status) => {
        console.log('📡 Realtime 구독 상태:', status);
      });

    return () => {
      console.log('🔌 Realtime 구독 해제');
      supabase.removeChannel(channel);
    };
  }, [dateFilter]);

  // 자동 베팅 동기화: 30초마다 active 세션 체크 후 동기화
  useEffect(() => {
    console.log('🎯 [AUTO-SYNC] 자동 베팅 동기화 시작');
    
    let isProcessing = false;
    
    const autoSync = async () => {
      if (isProcessing) {
        console.log('⏭️ [AUTO-SYNC] 이미 처리 중, 건너뜀');
        return;
      }
      
      try {
        // Active 세션 확인
        const { data: activeSessions, error } = await supabase
          .from('game_launch_sessions')
          .select('id')
          .eq('status', 'active')
          .limit(1);
        
        if (error) {
          console.error('❌ [AUTO-SYNC] 세션 조회 실패:', error);
          return;
        }
        
        if (!activeSessions || activeSessions.length === 0) {
          console.log('ℹ️ [AUTO-SYNC] Active 세션 없음, 동기화 건너뜀');
          return;
        }
        
        console.log('✅ [AUTO-SYNC] Active 세션 발견, 동기화 시작');
        
        isProcessing = true;
        
        const now = new Date();
        const year = now.getFullYear().toString();
        const month = (now.getMonth() + 1).toString();

        // 시스템의 모든 파트너 OPCODE 조회
        const { data: partners, error: partnersError } = await supabase
          .from("partners")
          .select("id, opcode, secret_key")
          .not("opcode", "is", null)
          .not("secret_key", "is", null);

        if (partnersError || !partners || partners.length === 0) {
          console.log('⚠️ [AUTO-SYNC] API 설정이 있는 파트너가 없음');
          return;
        }

        let totalSaved = 0;

        // 각 파트너별로 베팅 데이터 조회 및 저장
        for (const partner of partners) {
          try {
            // API 호출
            const result = await investApi.getGameHistory(
              partner.opcode,
              year,
              month,
              0,
              1000,
              partner.secret_key
            );

            if (result.error || !result.data) {
              console.log(`⚠️ [AUTO-SYNC] 파트너 ${partner.id} API 호출 실패`);
              continue;
            }

            // API 응답에서 베팅 데이터 추출
            let bettingRecords: any[] = [];
            
            if (result.data.DATA && Array.isArray(result.data.DATA)) {
              bettingRecords = result.data.DATA;
            } else if (Array.isArray(result.data)) {
              bettingRecords = result.data;
            }

            if (bettingRecords.length === 0) {
              console.log(`ℹ️ [AUTO-SYNC] 파트너 ${partner.id} 베팅 데이터 없음`);
              continue;
            }

            console.log(`📊 [AUTO-SYNC] 파트너 ${partner.id}: ${bettingRecords.length}건 처리`);

            // 베팅 기록 DB 저장
            for (const record of bettingRecords) {
              try {
                // username으로 user_id 조회
                const { data: userData } = await supabase
                  .from('users')
                  .select('id')
                  .eq('username', record.username)
                  .eq('referrer_id', partner.id)
                  .maybeSingle();

                if (!userData) continue;

                const externalTxid = (record.id || record.txid)?.toString();
                if (!externalTxid) continue;

                // 중복 체크
                const { data: existing } = await supabase
                  .from('game_records')
                  .select('id')
                  .eq('external_txid', externalTxid)
                  .eq('partner_id', partner.id)
                  .maybeSingle();

                if (existing) continue;

                // 새 레코드 insert
                const { error: insertError } = await supabase
                  .from('game_records')
                  .insert({
                    partner_id: partner.id,
                    external_txid: externalTxid,
                    username: record.username,
                    user_id: userData.id,
                    game_id: record.game || record.game_id,
                    provider_id: Math.floor((record.game || record.game_id) / 1000),
                    game_title: record.game_title || null,
                    provider_name: record.provider_name || null,
                    bet_amount: parseFloat(record.bet || record.bet_amount || '0'),
                    win_amount: parseFloat(record.win || record.win_amount || '0'),
                    balance_before: parseFloat(record.balance_before || '0'),
                    balance_after: parseFloat(record.balance || record.balance_after || '0'),
                    played_at: record.create_at || record.played_at || record.created_at || new Date().toISOString()
                  });

                if (!insertError) {
                  totalSaved++;
                }
              } catch (err) {
                // 개별 레코드 처리 실패는 무시
              }
            }

            // 사용자 잔고 업데이트 (Active 세션 있는 경우만)
            const userBalances = new Map<string, number>();
            bettingRecords.forEach((record: any) => {
              if (record.username && record.balance !== undefined) {
                userBalances.set(record.username, record.balance);
              }
            });

            for (const [username, balance] of userBalances) {
              const { data: userData } = await supabase
                .from('users')
                .select('id')
                .eq('username', username)
                .eq('referrer_id', partner.id)
                .maybeSingle();

              if (!userData) continue;

              // Active 세션 확인
              const { data: activeSession } = await supabase
                .from('game_launch_sessions')
                .select('id')
                .eq('user_id', userData.id)
                .eq('status', 'active')
                .limit(1)
                .maybeSingle();

              // Active 세션이 있는 경우에만 잔고 업데이트
              if (activeSession) {
                await supabase
                  .from('users')
                  .update({ balance: balance })
                  .eq('id', userData.id);
              }
            }

          } catch (error) {
            console.error(`❌ [AUTO-SYNC] 파트너 ${partner.id} 처리 오류:`, error);
          }
        }

        if (totalSaved > 0) {
          console.log(`✅ [AUTO-SYNC] 완료: ${totalSaved}건 저장`);
          // 데이터 재로드
          await loadBettingData();
        }
        
      } catch (err) {
        console.error('❌ [AUTO-SYNC] 자동 동기화 실패:', err);
      } finally {
        isProcessing = false;
      }
    };
    
    // 30초마다 실행
    const timer = setInterval(() => {
      console.log('⏰ [AUTO-SYNC] 30초 타이머 실행');
      autoSync();
    }, 30000);
    
    // 초기 15초 후 첫 실행
    const initialTimer = setTimeout(() => {
      console.log('⏰ [AUTO-SYNC] 초기 15초 타이머 실행');
      autoSync();
    }, 15000);
    
    return () => {
      console.log('🔌 [AUTO-SYNC] 타이머 정리');
      clearInterval(timer);
      clearTimeout(initialTimer);
    };
  }, []);

  // 검색 필터
  const filteredRecords = searchTerm
    ? bettingRecords.filter(record => 
        record.username?.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : bettingRecords;

  // 테이블 컬럼 정의
  const columns = [
    {
      key: 'external_txid',
      title: 'TX ID',
      render: (value: number | string) => (
        <Badge variant="outline" className="border-slate-600 text-slate-300">
          {value || '-'}
        </Badge>
      )
    },
    {
      key: 'username',
      title: '사용자',
      render: (value: string) => <span className="text-slate-300">{value || 'Unknown'}</span>
    },
    {
      key: 'game_title',
      title: '게임명',
      render: (value: string, record: BettingRecord) => (
        <span className="max-w-[200px] truncate text-slate-300" title={value || `Game ${record.game_id}`}>
          {value || `Game ${record.game_id}`}
        </span>
      )
    },
    {
      key: 'provider_name',
      title: '제공사',
      render: (value: string, record: BettingRecord) => (
        <Badge variant="secondary" className="bg-slate-700 text-slate-300">
          {value || `Provider ${record.provider_id}`}
        </Badge>
      )
    },
    {
      key: 'bet_amount',
      title: '베팅액',
      render: (value: number) => (
        <span className="font-mono text-cyan-400">₩{parseFloat(value?.toString() || '0').toLocaleString()}</span>
      )
    },
    {
      key: 'win_amount',
      title: '당첨액',
      render: (value: number) => {
        const amount = parseFloat(value?.toString() || '0');
        return (
          <span className={`font-mono ${amount > 0 ? 'text-emerald-400' : 'text-slate-500'}`}>
            ₩{amount.toLocaleString()}
          </span>
        );
      }
    },
    {
      key: 'balance_before',
      title: '베팅전금액',
      render: (value: number) => (
        <span className="font-mono text-purple-400">₩{parseFloat(value?.toString() || '0').toLocaleString()}</span>
      )
    },
    {
      key: 'balance_after',
      title: '베팅후금액',
      render: (value: number) => (
        <span className="font-mono text-indigo-400">₩{parseFloat(value?.toString() || '0').toLocaleString()}</span>
      )
    },
    {
      key: 'played_at',
      title: '손익',
      render: (value: string, record: BettingRecord) => {
        const profitLoss = parseFloat(record.win_amount?.toString() || '0') - parseFloat(record.bet_amount?.toString() || '0');
        return (
          <span className={`font-mono ${profitLoss > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {profitLoss > 0 ? '+' : ''}₩{profitLoss.toLocaleString()}
          </span>
        );
      }
    },
    {
      key: 'played_at',
      title: '플레이 시간',
      render: (value: string) => formatKoreanDate(value)
    }
  ];

  return (
    <div className="space-y-6">
      {/* 통계 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        <MetricCard
          title="총 베팅 수"
          value={`${stats.totalBets.toLocaleString()}건`}
          subtitle="전체 게임 수"
          icon={CreditCard}
          color="purple"
        />
        
        <MetricCard
          title="총 베팅액"
          value={`₩${stats.totalBetAmount.toLocaleString()}`}
          subtitle="누적 베팅 금액"
          icon={CreditCard}
          color="cyan"
        />
        
        <MetricCard
          title="총 당첨액"
          value={`₩${stats.totalWinAmount.toLocaleString()}`}
          subtitle="누적 당첨 금액"
          icon={CreditCard}
          color="green"
        />
        
        <MetricCard
          title="순손익"
          value={`${stats.netProfit > 0 ? '+' : ''}₩${stats.netProfit.toLocaleString()}`}
          subtitle={stats.netProfit > 0 ? "↑ 수익" : "↓ 손실"}
          icon={CreditCard}
          color={stats.netProfit > 0 ? "green" : "rose"}
        />
      </div>

      {/* 베팅 내역 테이블 */}
      <div className="glass-card rounded-xl p-6">
        <div className="mb-6">
          <div className="flex justify-between items-center mb-2">
            <div>
              <h3 className="font-semibold text-slate-100">베팅 내역</h3>
              <p className="text-sm text-slate-400 mt-1">{user.nickname}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button 
                onClick={manualSyncFromApi} 
                disabled={loading || syncing} 
                size="sm"
                variant="outline"
                className="border-amber-600/50 text-amber-400 hover:bg-amber-600/20"
              >
                <CloudDownload className="h-4 w-4 mr-2" />
                {syncing ? '업데이트 중...' : '베팅기록업데이트'}
              </Button>
              <Button 
                onClick={downloadExcel} 
                disabled={loading || filteredRecords.length === 0} 
                size="sm"
                className="border-slate-700 text-slate-300 hover:bg-slate-700/50"
              >
                <Download className="h-4 w-4 mr-2" />
                다운로드
              </Button>
            </div>
          </div>
          <p className="text-sm text-slate-400">
            조회: {filteredRecords.length}건 / 전체: {bettingRecords.length}건
          </p>
        </div>
        
        <div className="space-y-4">
          {/* 필터 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-slate-300">기간</Label>
              <Select value={dateFilter} onValueChange={setDateFilter}>
                <SelectTrigger className="input-premium">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  <SelectItem value="today">오늘</SelectItem>
                  <SelectItem value="week">최근 7일</SelectItem>
                  <SelectItem value="month">최근 30일</SelectItem>
                  <SelectItem value="all">전체</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-slate-300">사용자명 검색</Label>
              <Input
                placeholder="사용자명 입력..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="input-premium"
              />
            </div>
          </div>

          {/* 데이터 테이블 */}
          {loading ? (
            <div className="flex justify-center py-12">
              <LoadingSpinner />
            </div>
          ) : filteredRecords.length > 0 ? (
            <DataTable columns={columns} data={filteredRecords} />
          ) : (
            <div className="text-center py-12 text-slate-400">
              <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>조회된 베팅 내역이 없습니다.</p>
              <p className="text-sm mt-2">
                {searchTerm 
                  ? '검색 조건을 변경해보세요.' 
                  : dateFilter !== 'all'
                    ? '날짜 범위를 변경하거나 "전체"를 선택해보세요.'
                    : 'DB에 베팅 데이터가 없습니다. 비상 동기화 버튼을 눌러보세요.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}