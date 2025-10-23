import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Alert, AlertDescription } from '../ui/alert';
import { Badge } from '../ui/badge';
import { Loader2, Users, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { investApi } from '../../lib/investApi';
import { toast } from 'sonner@2.0.3';

interface User {
  id: string;
  username: string;
  nickname: string;
  status: string;
  created_at: string;
}

interface ApiAccountResult {
  username: string;
  success: boolean;
  error?: string;
  response?: any;
}

export function CreateMissingApiAccounts() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<ApiAccountResult[]>([]);

  // 사용자 목록 로드
  const loadUsers = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, username, nickname, status, created_at')
        .eq('status', 'active')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setUsers(data || []);
      console.log('👥 사용자 목록 로드:', data?.length || 0, '명');
    } catch (error) {
      console.error('사용자 목록 로드 오류:', error);
      toast.error('사용자 목록을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 모든 사용자의 API 계정 생성
  const createApiAccountsForAllUsers = async () => {
    if (users.length === 0) {
      toast.error('사용자 목록을 먼저 로드해주세요.');
      return;
    }

    setProcessing(true);
    const newResults: ApiAccountResult[] = [];

    try {
      // OPCODE 정보 조회
      const { data: opcodeData, error: opcodeError } = await supabase
        .rpc('get_system_opcode_for_account_creation');

      if (opcodeError || !opcodeData || opcodeData.length === 0) {
        throw new Error('OPCODE 정보를 찾을 수 없습니다.');
      }

      const { opcode, secret_key } = opcodeData[0];
      console.log('🔑 OPCODE 정보:', { opcode, secret_key: '***' + secret_key.slice(-4) });

      // 각 사용자에 대해 API 계정 생성
      for (const user of users) {
        console.log(`🔄 ${user.username} API 계정 생성 시작...`);
        
        try {
          const result = await investApi.createAccount(opcode, user.username, secret_key);
          
          if (result.error) {
            console.error(`❌ ${user.username} 계정 생성 실패:`, result.error);
            newResults.push({
              username: user.username,
              success: false,
              error: result.error,
              response: result.data
            });

            // 실패 로그 기록
            await supabase.rpc('log_api_account_creation', {
              p_user_id: user.id,
              p_username: user.username,
              p_success: false,
              p_error_message: result.error
            });
          } else {
            console.log(`✅ ${user.username} 계정 생성 성공:`, result.data);
            newResults.push({
              username: user.username,
              success: true,
              response: result.data
            });

            // 성공 로그 기록
            await supabase.rpc('log_api_account_creation', {
              p_user_id: user.id,
              p_username: user.username,
              p_success: true,
              p_error_message: null
            });
          }
        } catch (userError) {
          console.error(`❌ ${user.username} 계정 생성 예외:`, userError);
          const errorMessage = userError instanceof Error ? userError.message : '알 수 없는 오류';
          
          newResults.push({
            username: user.username,
            success: false,
            error: errorMessage
          });

          // 실패 로그 기록
          await supabase.rpc('log_api_account_creation', {
            p_user_id: user.id,
            p_username: user.username,
            p_success: false,
            p_error_message: errorMessage
          });
        }

        // API 부하 방지를 위한 딜레이
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      setResults(newResults);
      
      const successCount = newResults.filter(r => r.success).length;
      const failCount = newResults.filter(r => !r.success).length;
      
      toast.success(`API 계정 생성 완료: 성공 ${successCount}개, 실패 ${failCount}개`);
      
    } catch (error) {
      console.error('API 계정 생성 프로세스 오류:', error);
      toast.error('API 계정 생성 중 오류가 발생했습니다.');
    } finally {
      setProcessing(false);
    }
  };

  // 특정 사용자의 API 계정 생성
  const createApiAccountForUser = async (user: User) => {
    setProcessing(true);
    
    try {
      // OPCODE 정보 조회
      const { data: opcodeData, error: opcodeError } = await supabase
        .rpc('get_system_opcode_for_account_creation');

      if (opcodeError || !opcodeData || opcodeData.length === 0) {
        throw new Error('OPCODE 정보를 찾을 수 없습니다.');
      }

      const { opcode, secret_key } = opcodeData[0];
      
      const result = await investApi.createAccount(opcode, user.username, secret_key);
      
      if (result.error) {
        toast.error(`${user.username} 계정 생성 실패: ${result.error}`);
        
        // 실패 로그 기록
        await supabase.rpc('log_api_account_creation', {
          p_user_id: user.id,
          p_username: user.username,
          p_success: false,
          p_error_message: result.error
        });
      } else {
        toast.success(`${user.username} 계정이 성공적으로 생성되었습니다.`);
        
        // 성공 로그 기록
        await supabase.rpc('log_api_account_creation', {
          p_user_id: user.id,
          p_username: user.username,
          p_success: true,
          p_error_message: null
        });
      }
    } catch (error) {
      console.error('API 계정 생성 오류:', error);
      toast.error('API 계정 생성 중 오류가 발생했습니다.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">누락된 API 계정 생성</h1>
          <p className="text-muted-foreground">
            기존 사용자들의 Invest API 계정을 생성합니다.
          </p>
        </div>
        <Button onClick={loadUsers} disabled={loading}>
          {loading ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4 mr-2" />
          )}
          사용자 목록 새로고침
        </Button>
      </div>

      {/* 사용자 목록 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            등록된 사용자 목록 ({users.length}명)
          </CardTitle>
          <CardDescription>
            활성 상태인 사용자들의 목록입니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">
                {loading ? '사용자 목록을 불러오는 중...' : '등록된 사용자가 없습니다.'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex gap-2 mb-4">
                <Button 
                  onClick={createApiAccountsForAllUsers}
                  disabled={processing}
                  className="gap-2"
                >
                  {processing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle className="w-4 h-4" />
                  )}
                  모든 사용자 API 계정 생성
                </Button>
              </div>
              
              <div className="grid gap-2">
                {users.map((user) => (
                  <div key={user.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-3">
                      <div>
                        <p className="font-medium">{user.username}</p>
                        <p className="text-sm text-muted-foreground">{user.nickname}</p>
                      </div>
                      <Badge variant={user.status === 'active' ? 'default' : 'secondary'}>
                        {user.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-muted-foreground">
                        {new Date(user.created_at).toLocaleDateString()}
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => createApiAccountForUser(user)}
                        disabled={processing}
                      >
                        계정 생성
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 결과 표시 */}
      {results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>API 계정 생성 결과</CardTitle>
            <CardDescription>
              최근 실행된 API 계정 생성 작업의 결과입니다.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {results.map((result, index) => (
                <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center gap-3">
                    {result.success ? (
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-500" />
                    )}
                    <span className="font-medium">{result.username}</span>
                  </div>
                  <div className="text-right">
                    {result.success ? (
                      <Badge variant="default" className="bg-green-500">성공</Badge>
                    ) : (
                      <div className="space-y-1">
                        <Badge variant="destructive">실패</Badge>
                        {result.error && (
                          <p className="text-xs text-red-500 max-w-xs truncate">
                            {result.error}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Alert>
        <AlertDescription>
          <strong>주의:</strong> 이 도구는 기존 사용자들의 누락된 Invest API 계정을 생성하기 위한 임시 도구입니다. 
          앞으로 신규 회원가입 시에는 자동으로 API 계정이 생성됩니다.
        </AlertDescription>
      </Alert>
    </div>
  );
}

export default CreateMissingApiAccounts;