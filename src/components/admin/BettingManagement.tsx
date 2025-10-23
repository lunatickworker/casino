import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Badge } from "../ui/badge";
import { DataTable } from "../common/DataTable";
import { LoadingSpinner } from "../common/LoadingSpinner";
import { toast } from "sonner@2.0.3";
import { Label } from "../ui/label";
import { RefreshCw, Download, AlertCircle, CloudDownload } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { getGameHistory } from "../../lib/investApi";
import { Partner } from "../../types";

interface BettingManagementProps {
  user: Partner;
}

interface BettingRecord {
  id: string;
  external_txid: number;
  user_id: string;
  username: string;
  referrer_nickname: string; // 소속 추가
  game_name: string;
  provider_name: string;
  bet_amount: number;
  win_amount: number;
  balance_before: number;
  balance_after: number;
  played_at: string;
  profit_loss: number;
}

export function BettingManagement({ user }: BettingManagementProps) {
  const [loading, setLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [bettingRecords, setBettingRecords] = useState<BettingRecord[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [totalBets, setTotalBets] = useState(0);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);

  // 권한 확인 (시스템관리자 = level 1, 대본사 = level 2만 접근 가능)
  if (user.level > 2) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-4">
          <AlertCircle className="h-12 w-12 text-yellow-500 mx-auto" />
          <p className="text-muted-foreground">베팅 내역 관리는 대본사 이상만 접근 가능합니다.</p>
        </div>
      </div>
    );
  }

  // ✅ 페이지 진입 시 자동으로 베팅 내역 조회
  useEffect(() => {
    fetchBettingRecords();
  }, []);

  // Realtime subscription for game_records table
  useEffect(() => {
    const channel = supabase
      .channel('game-records-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'game_records'
        },
        (payload) => {
          console.log('🎮 game_records 테이블 변경 감지:', payload);
          fetchBettingRecords();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // 직접 쿼리로 베팅 내역 조회 (모든 최신 데이터)
  const fetchBettingRecords = async () => {
    try {
      setLoading(true);
      
      console.log('📊 전체 베팅 내역 조회 시작...');

      const { data, error, count } = await supabase
        .from('game_records')
        .select(`
          id,
          external_txid,
          user_id,
          username,
          game_id,
          provider_id,
          bet_amount,
          win_amount,
          balance_before,
          balance_after,
          played_at,
          games(name),
          game_providers(name),
          users!game_records_user_id_fkey(
            referrer_id,
            referrer:partners!users_referrer_id_fkey(nickname)
          )
        `, { count: 'exact' })
        .order('played_at', { ascending: false })
        .limit(1000);

      if (error) {
        console.error('❌ 조회 오류:', error);
        toast.error('베팅 내역 조회 오류', {
          description: `${error.message}`
        });
        throw error;
      }

      console.log('✅ 조회 결과:', { 
        count, 
        dataLength: data?.length,
        sampleData: data?.slice(0, 2)
      });

      const records: BettingRecord[] = (data || []).map((record: any) => ({
        id: record.id,
        external_txid: record.external_txid || 0,
        user_id: record.user_id,
        username: record.username || 'Unknown',
        referrer_nickname: record.users?.referrer?.nickname || '-',
        game_name: record.games?.name || `Game ${record.game_id}`,
        provider_name: record.game_providers?.name || `Provider ${record.provider_id}`,
        bet_amount: parseFloat(record.bet_amount || 0),
        win_amount: parseFloat(record.win_amount || 0),
        balance_before: parseFloat(record.balance_before || 0),
        balance_after: parseFloat(record.balance_after || 0),
        played_at: record.played_at,
        profit_loss: parseFloat(record.win_amount || 0) - parseFloat(record.bet_amount || 0)
      }));

      setBettingRecords(records);
      setTotalBets(count || 0);
      
      if (records.length === 0) {
        toast.warning('⚠️ 베팅 내역이 없습니다', {
          description: '"베팅내역가져오기" 버튼을 클릭하여 데이터를 동기화하세요.'
        });
      } else {
        toast.success(`✅ ${records.length}건 조회 완료 (전체 ${count}건)`);
      }
    } catch (error) {
      console.error('❌ 베팅 내역 조회 오류:', error);
      toast.error('베팅 내역 조회 실패', {
        description: error instanceof Error ? error.message : '알 수 없는 오류'
      });
      setBettingRecords([]);
    } finally {
      setLoading(false);
    }
  };

  // API에서 베팅 내역 가져오기
  const syncBettingFromApi = async () => {
    try {
      setSyncLoading(true);
      
      const { getAdminOpcode, isMultipleOpcode } = await import('../../lib/opcodeHelper');
      
      let opcode: string;
      let secretKey: string;
      
      try {
        const opcodeInfo = await getAdminOpcode(user);
        
        if (isMultipleOpcode(opcodeInfo)) {
          if (opcodeInfo.opcodes.length === 0) {
            toast.error('등록된 대본사가 없습니다.');
            return;
          }
          
          const firstOpcode = opcodeInfo.opcodes[0];
          opcode = firstOpcode.opcode;
          secretKey = firstOpcode.secretKey;
          
          toast.info(`${firstOpcode.partnerName}의 OPCODE로 동기화를 시작합니다.`, {
            description: `총 ${opcodeInfo.opcodes.length}개의 대본사 중 첫 번째`
          });
        } else {
          opcode = opcodeInfo.opcode;
          secretKey = opcodeInfo.secretKey;
          
          console.log(`✅ ${user.partner_type} - ${opcodeInfo.partnerName} OPCODE 사용`);
        }
      } catch (error: any) {
        toast.error('OPCODE 조회 실패', {
          description: error.message
        });
        return;
      }

      const now = new Date();
      const year = now.getFullYear().toString();
      const month = (now.getMonth() + 1).toString();
      
      console.log('📥 베팅 내역 API 호출:', { year, month, opcode });
      
      const apiResult = await getGameHistory(
        opcode,
        year,
        month,
        0,
        4000,
        secretKey
      );

      if (apiResult.error) {
        toast.error('API 호출 오류', {
          description: apiResult.error
        });
        return;
      }

      const apiData = apiResult.data?.DATA || [];
      
      if (!Array.isArray(apiData) || apiData.length === 0) {
        toast.info('가져올 베팅 데이터가 없습니다.');
        setLastSyncTime(new Date().toISOString());
        return;
      }

      console.log('✅ API 응답:', { 레코드수: apiData.length, 샘플: apiData[0] });

      const formattedRecords = apiData.map((record: any) => ({
        txid: record.txid?.toString() || record.id?.toString(),
        username: record.username || record.user_id,
        provider_id: record.provider_id || Math.floor((record.game_id || 0) / 1000),
        game_id: record.game_id?.toString() || '0',
        game_name: record.game_name || 'Unknown',
        bet_amount: parseFloat(record.bet_amount || record.bet || 0),
        win_amount: parseFloat(record.win_amount || record.win || 0),
        profit_loss: parseFloat(record.profit_loss || record.win_loss || 
                     ((record.win_amount || record.win || 0) - (record.bet_amount || record.bet || 0))),
        currency: record.currency || 'KRW',
        status: record.status || 'completed',
        round_id: record.round_id,
        session_id: record.session_id,
        game_start_time: record.game_start_time || record.start_time,
        game_end_time: record.game_end_time || record.end_time || record.played_at || record.created_at
      }));

      const { data: saveResult, error: saveError } = await supabase
        .rpc('save_betting_records_from_api', {
          p_records: formattedRecords
        });

      if (saveError) {
        console.error('❌ 저장 함수 호출 실패:', saveError);
        toast.error('베팅 내역 저장 실패', {
          description: saveError.message
        });
        return;
      }

      const result = saveResult?.[0] || { 
        saved_count: 0, 
        skipped_count: 0, 
        error_count: 0, 
        errors: [] 
      };

      console.log('✅ 저장 결과:', result);

      const syncTime = new Date().toISOString();
      setLastSyncTime(syncTime);

      if (result.saved_count > 0) {
        toast.success(`베팅 내역 ${result.saved_count}건 저장 완료`, {
          description: `동기화 시간: ${syncTime}${result.skipped_count > 0 ? ` (중복 ${result.skipped_count}건 스킵)` : ''}`
        });
        
        fetchBettingRecords();
      } else if (result.skipped_count > 0) {
        toast.info(`모든 데이터가 이미 존재합니다 (${result.skipped_count}건)`);
      }

      if (result.error_count > 0 && result.errors && result.errors.length > 0) {
        console.warn('⚠️ 일부 저장 오류:', result.errors);
        toast.warning(`${result.error_count}건 저장 실패`, {
          description: `성공: ${result.saved_count}건, 스킵: ${result.skipped_count}건\n첫 번째 에러: ${result.errors[0]}`
        });
      }

    } catch (error) {
      console.error('❌ 베팅 동기화 오류:', error);
      toast.error('베팅 내역 가져오기 실패', {
        description: error instanceof Error ? error.message : '알 수 없는 오류'
      });
    } finally {
      setSyncLoading(false);
    }
  };

  // 엑셀 다운로드
  const downloadExcel = () => {
    try {
      const csvContent = [
        ['사용자', '소속', '게임명', '제공사', '베팅액', '당첨액', '손익', '플레이 시간'].join(','),
        ...filteredRecords.map(record => [
          record.username,
          record.referrer_nickname,
          `"${record.game_name}"`,
          record.provider_name,
          record.bet_amount,
          record.win_amount,
          record.profit_loss,
          record.played_at
        ].join(','))
      ].join('\n');

      const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `betting_${new Date().toISOString().split('T')[0]}.csv`);
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
    fetchBettingRecords();
  }, []);

  // 사용자 검색 필터링
  const filteredRecords = userSearch
    ? bettingRecords.filter(record => 
        record.username.toLowerCase().includes(userSearch.toLowerCase())
      )
    : bettingRecords;

  const columns = [
    {
      key: 'username',
      title: '사용자'
    },
    {
      key: 'referrer_nickname',
      title: '소속',
      render: (value: string) => (
        <Badge variant="outline" className="bg-slate-800/50 border-slate-600">
          {value}
        </Badge>
      )
    },
    {
      key: 'game_name',
      title: '게임명',
      render: (value: string) => (
        <span className="max-w-[200px] truncate" title={value}>{value}</span>
      )
    },
    {
      key: 'provider_name',
      title: '제공사',
      render: (value: string) => <Badge variant="secondary">{value}</Badge>
    },
    {
      key: 'bet_amount',
      title: '베팅액',
      render: (value: number) => (
        <span className="font-mono text-blue-600">₩{value.toLocaleString()}</span>
      )
    },
    {
      key: 'win_amount',
      title: '당첨액',
      render: (value: number) => (
        <span className={`font-mono ${value > 0 ? 'text-green-600' : 'text-gray-500'}`}>
          ₩{value.toLocaleString()}
        </span>
      )
    },
    {
      key: 'profit_loss',
      title: '손익',
      render: (value: number) => (
        <span className={`font-mono ${value > 0 ? 'text-green-600' : 'text-red-600'}`}>
          {value > 0 ? '+' : ''}₩{value.toLocaleString()}
        </span>
      )
    },
    {
      key: 'played_at',
      title: '플레이 시간',
      render: (value: string) => value ? new Date(value).toISOString().replace('T', ' ').substring(0, 19) : '-'
    }
  ];

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-100">베팅 내역 관리</h1>
          <p className="text-sm text-slate-400">
            조회: {filteredRecords.length}건 / 전체: {totalBets}건
            {lastSyncTime && (
              <span className="ml-4 text-green-400">
                마지막 동기화: {new Date(lastSyncTime).toLocaleString('ko-KR')}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            onClick={syncBettingFromApi} 
            disabled={syncLoading} 
            className="btn-premium-primary"
          >
            <CloudDownload className="h-4 w-4 mr-2" />
            {syncLoading ? '가져오는 중...' : '베팅내역가져오기'}
          </Button>
          <Button 
            onClick={downloadExcel} 
            disabled={loading || filteredRecords.length === 0} 
            variant="outline" 
            className="border-slate-600 hover:bg-slate-700"
          >
            <Download className="h-4 w-4 mr-2" />
            다운로드
          </Button>
        </div>
      </div>

      <div className="glass-card rounded-xl p-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-700/50">
            <div>
              <Label className="text-slate-300">사용자명 검색</Label>
              <Input
                placeholder="사용자명 입력..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                className="input-premium max-w-xs"
              />
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <LoadingSpinner />
            </div>
          ) : filteredRecords.length > 0 ? (
            <DataTable 
              columns={columns} 
              data={filteredRecords} 
              enableSearch={false}
            />
          ) : (
            <div className="text-center py-12 text-slate-400">
              <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>조회된 베팅 내역이 없습니다.</p>
              <p className="text-sm mt-2">
                {userSearch ? '검색 조건을 변경해보세요.' : '"베팅내역가져오기" 버튼을 클릭하여 데이터를 동기화하세요.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
