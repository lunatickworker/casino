import { useState, useEffect } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Alert, AlertDescription } from "../ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Loader2, Eye, EyeOff, CheckCircle, XCircle } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { investApi } from "../../lib/investApi";
import { toast } from "sonner@2.0.3";

interface UserLoginProps {
  onLoginSuccess: (user: any) => void;
}

interface Bank {
  id: string;
  bank_code: string;
  bank_name: string;
}

// UUID 생성 헬퍼 함수
const generateUUID = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback UUID 생성
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

export function UserLogin({ onLoginSuccess }: UserLoginProps) {
  const [activeTab, setActiveTab] = useState("login");
  
  // 로그인 폼 데이터
  const [loginData, setLoginData] = useState({
    username: '',
    password: ''
  });
  
  // 회원가입 폼 데이터
  const [registerData, setRegisterData] = useState({
    username: '',
    nickname: '',
    password: '',
    email: '',
    phone: '',
    bank_name: '',
    bank_account: '',
    bank_holder: '',
    referrer_username: ''
  });
  
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [nicknameCheck, setNicknameCheck] = useState<{
    status: 'idle' | 'checking' | 'available' | 'unavailable';
    message: string;
  }>({ status: 'idle', message: '' });

  // 은행 목록 로드
  useEffect(() => {
    const loadBanks = async () => {
      try {
        const { data, error } = await supabase
          .from('banks')
          .select('*')
          .eq('is_active', true)
          .order('bank_name');
        
        if (error) throw error;
        setBanks(data || []);
      } catch (error) {
        console.error('은행 목록 로드 오류:', error);
      }
    };
    
    loadBanks();
  }, []);

  // 로그인 폼 핸들러
  const handleLoginChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setLoginData(prev => ({
      ...prev,
      [name]: value
    }));
    if (error) setError(null);
  };

  // 회원가입 폼 핸들러
  const handleRegisterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setRegisterData(prev => ({
      ...prev,
      [name]: value
    }));
    if (error) setError(null);
  };

  // 닉네임 중복 체크 (직접 SELECT)
  const checkNickname = async (nickname: string) => {
    if (!nickname.trim()) {
      setNicknameCheck({ status: 'idle', message: '' });
      return;
    }

    setNicknameCheck({ status: 'checking', message: '확인 중...' });

    try {
      const { data, error } = await supabase
        .from('users')
        .select('id')
        .eq('nickname', nickname.trim())
        .limit(1);

      if (error) throw error;

      if (data && data.length > 0) {
        setNicknameCheck({
          status: 'unavailable',
          message: '이미 사용 중인 닉네임입니다.'
        });
      } else {
        setNicknameCheck({
          status: 'available',
          message: '사용 가능한 닉네임입니다.'
        });
      }
    } catch (error) {
      console.error('닉네임 체크 오류:', error);
      setNicknameCheck({ status: 'unavailable', message: '확인 중 오류가 발생했습니다.' });
    }
  };

  // 로그인 처리
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!loginData.username.trim() || !loginData.password.trim()) {
      setError('아이디와 비밀번호를 모두 입력해주세요.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // 사용자 로그인 함수 호출
      const { data, error: loginError } = await supabase
        .rpc('user_login', {
          p_username: loginData.username.trim(),
          p_password: loginData.password
        });

      if (loginError) {
        throw loginError;
      }

      if (!data || data.length === 0) {
        setError('아이디 또는 비밀번호가 올바르지 않습니다.');
        return;
      }

      const user = data[0];

      // 사용자 상태 확인
      if (user.status === 'blocked') {
        setError('차단된 계정입니다. 고객센터에 문의해주세요.');
        return;
      }

      if (user.status === 'pending') {
        setError('승인 대기 중인 계정입니다. 잠시 후 다시 시도해주세요.');
        return;
      }

      // 로그인 성공 시 세션 생성
      const sessionData = {
        user_id: user.id,
        session_token: generateUUID(),
        ip_address: null,
        device_info: {
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          language: navigator.language
        }
      };

      const { error: sessionError } = await supabase
        .from('user_sessions')
        .insert([sessionData]);

      if (sessionError) {
        console.error('세션 생성 오류:', sessionError);
      }

      // 온라인 상태 업데이트
      await supabase
        .from('users')
        .update({ 
          is_online: true,
          last_login_at: new Date().toISOString()
        })
        .eq('id', user.id);

      // 로그인 로그 기록
      await supabase
        .from('activity_logs')
        .insert([{
          actor_type: 'user',
          actor_id: user.id,
          action: 'login',
          details: {
            username: user.username,
            login_time: new Date().toISOString()
          }
        }]);

      // 로컬 스토리지에 사용자 정보 저장
      localStorage.setItem('user_session', JSON.stringify(user));

      toast.success(`${user.nickname}님, 환영합니다!`);
      onLoginSuccess(user);

    } catch (error: any) {
      console.error('로그인 오류:', error);
      setError(error.message || '로그인 중 오류가 발생했습니다.');
      toast.error('로그인에 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  // 회원가입 처리
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // 필수 필드 검증
    if (!registerData.username.trim()) {
      setError('아이디를 입력해주세요.');
      return;
    }
    
    if (!registerData.nickname.trim()) {
      setError('닉네임을 입력해주세요.');
      return;
    }
    
    if (nicknameCheck.status !== 'available') {
      setError('닉네임 중복 확인을 완료해주세요.');
      return;
    }
    
    if (!registerData.password.trim()) {
      setError('비밀번호를 입력해주세요.');
      return;
    }
    
    if (!registerData.referrer_username.trim()) {
      setError('추천인을 입력해주세요.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // 1단계: 추천인 확인 (partners 테이블에서 조회)
      const { data: referrerData, error: referrerError } = await supabase
        .from('partners')
        .select('id')
        .eq('username', registerData.referrer_username.trim())
        .maybeSingle();

      if (referrerError) {
        console.error('추천인 조회 에러:', referrerError);
        setError('추천인 조회 중 오류가 발생했습니다.');
        return;
      }

      if (!referrerData) {
        setError('존재하지 않는 추천인입니다.');
        return;
      }

      // 2단계: 로컬 DB에 사용자 생성 (직접 INSERT)
      const { data: newUser, error: insertError } = await supabase
        .from('users')
        .insert([{
          username: registerData.username.trim(),
          nickname: registerData.nickname.trim(),
          password_hash: registerData.password, // 283 트리거에서 자동 암호화
          email: registerData.email.trim() || null,
          phone: registerData.phone.trim() || null,
          bank_name: registerData.bank_name || null,
          bank_account: registerData.bank_account.trim() || null,
          bank_holder: registerData.bank_holder.trim() || null,
          referrer_id: referrerData.id,
          status: 'pending',
          balance: 0,
          points: 0
        }])
        .select('id, username')
        .single();

      if (insertError) {
        if (insertError.code === '23505') { // Unique violation
          if (insertError.message.includes('username')) {
            setError('이미 사용 중인 아이디입니다.');
          } else if (insertError.message.includes('nickname')) {
            setError('이미 사용 중인 닉네임입니다.');
          } else {
            setError('중복된 정보가 있습니다.');
          }
        } else {
          setError(insertError.message || '회원가입에 실패했습니다.');
        }
        return;
      }

      if (!newUser) {
        setError('회원가입 처리 중 오류가 발생했습니다.');
        return;
      }

      // 3단계: Invest API에 계정 생성
      try {
        console.log('🔗 Invest API 계정 생성 시도:', registerData.username.trim());
        
        // OPCODE 정보 조회 (DB 함수 사용 - 재귀적으로 상위 대본까지 조회)
        const { data: opcodeData, error: opcodeError } = await supabase
          .rpc('get_user_opcode', { user_id: newUser.id });

        if (opcodeError) {
          console.error('❌ OPCODE 정보 조회 실패:', opcodeError);
          toast.warning('회원가입은 완료되었지만 게임 계정 연동에 실패했습니다. 관리자에게 문의해주세요.');
        } else if (!opcodeData || opcodeData.length === 0) {
          console.error('❌ OPCODE 정보를 찾을 수 없음 (모든 상위 파트너 확인 완료)');
          toast.warning('회원가입은 완료되었지만 게임 계정 연동에 실패했습니다. 관리자에게 문의해주세요.');
        } else {
          const { opcode, secret_key } = opcodeData[0];
          console.log('✅ OPCODE 정보 조회 성공:', { opcode });
          
          // Invest API를 통한 계정 생성
          const createAccountResult = await investApi.createAccount(
            opcode, 
            registerData.username.trim(), 
            secret_key
          );

          if (createAccountResult.error) {
            console.error('❌ Invest API 계정 생성 실패:', createAccountResult.error);
            toast.warning('회원가입은 완료되었지만 게임 계정 연동에 실패했습니다. 관리자에게 문의해주세요.');
          } else {
            console.log('✅ Invest API 계정 생성 성공:', createAccountResult.data);
            
            // 활동 로그 기록
            await supabase
              .from('activity_logs')
              .insert([{
                actor_type: 'user',
                actor_id: newUser.id,
                action: 'api_account_creation',
                details: {
                  username: registerData.username.trim(),
                  success: true,
                  api_response: createAccountResult.data
                }
              }]);
            
            toast.success('회원가입 및 게임 계정이 성공적으로 생성되었습니다!');
          }
        }
      } catch (apiError) {
        console.error('❌ Invest API 계정 생성 예외:', apiError);
        
        // 실패 로그 기록
        try {
          await supabase
            .from('activity_logs')
            .insert([{
              actor_type: 'user',
              actor_id: newUser.id,
              action: 'api_account_creation',
              details: {
                username: registerData.username.trim(),
                success: false,
                error: apiError instanceof Error ? apiError.message : '알 수 없는 오류'
              }
            }]);
        } catch (logError) {
          console.error('로그 기록 실패:', logError);
        }
        
        toast.warning('회원가입은 완료되었지만 게임 계정 연동에 실패했습니다. 관리자에게 문의해주세요.');
      }

      // 회원가입 성공 시 로그인 탭으로 이동하고 아이디 자동 입력
      setActiveTab('login');
      setLoginData(prev => ({
        ...prev,
        username: registerData.username
      }));
      
      // 회원가입 폼 초기화
      setRegisterData({
        username: '',
        nickname: '',
        password: '',
        email: '',
        phone: '',
        bank_name: '',
        bank_account: '',
        bank_holder: '',
        referrer_username: ''
      });
      setNicknameCheck({ status: 'idle', message: '' });

    } catch (error: any) {
      console.error('회원가입 오류:', error);
      setError(error.message || '회원가입 중 오류가 발생했습니다.');
      toast.error('회원가입에 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center casino-gradient-bg p-4">
      <div className="w-full max-w-md">
        {/* VIP 제목 */}
        <div className="text-center mb-8">
          <h1 className="text-5xl font-bold gold-text neon-glow mb-2 tracking-wide">VIP CASINO</h1>
          <p className="text-yellow-300/80 text-lg tracking-wider">LUXURY GAMING EXPERIENCE</p>
        </div>

        <Card className="luxury-card border-2 border-yellow-600/40 shadow-2xl backdrop-blur-sm">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-2xl text-center gold-text neon-glow">VIP 로그인</CardTitle>
            <CardDescription className="text-center text-yellow-300/80">
              VIP 계정으로 로그인하세요
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-2 bg-black/50 mb-6 border border-yellow-600/30">
                <TabsTrigger value="login" className="text-yellow-200 data-[state=active]:bg-gradient-to-r data-[state=active]:from-yellow-600 data-[state=active]:to-amber-600 data-[state=active]:text-white data-[state=active]:font-bold data-[state=active]:shadow-lg">
                  VIP 로그인
                </TabsTrigger>
                <TabsTrigger value="register" className="text-yellow-200 data-[state=active]:bg-gradient-to-r data-[state=active]:from-yellow-600 data-[state=active]:to-amber-600 data-[state=active]:text-white data-[state=active]:font-bold data-[state=active]:shadow-lg">
                  VIP 가입
                </TabsTrigger>
              </TabsList>

              <TabsContent value="login" className="space-y-4">
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="login-username" className="text-yellow-300 font-semibold">VIP 아이디</Label>
                    <Input
                      id="login-username"
                      name="username"
                      type="text"
                      placeholder="VIP 아이디를 입력하세요"
                      value={loginData.username}
                      onChange={handleLoginChange}
                      disabled={isLoading}
                      className="bg-black/50 border-yellow-600/30 text-white placeholder:text-yellow-200/50 focus:border-yellow-500 focus:ring-yellow-500/20"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="login-password" className="text-slate-300">비밀번호</Label>
                    <div className="relative">
                      <Input
                        id="login-password"
                        name="password"
                        type={showPassword ? "text" : "password"}
                        placeholder="비밀번호를 입력하세요"
                        value={loginData.password}
                        onChange={handleLoginChange}
                        disabled={isLoading}
                        className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400 focus:border-blue-500 pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <Button
                    type="submit"
                    disabled={isLoading}
                    className="w-full bg-gradient-to-r from-yellow-500 to-orange-600 hover:from-yellow-600 hover:to-orange-700 text-white py-3"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        로그인 중...
                      </>
                    ) : (
                      '로그인'
                    )}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="register" className="space-y-4">
                <form onSubmit={handleRegister} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="register-username" className="text-slate-300">
                        아이디 <span className="text-red-400">*</span>
                      </Label>
                      <Input
                        id="register-username"
                        name="username"
                        type="text"
                        placeholder="아이디를 입력하세요"
                        value={registerData.username}
                        onChange={handleRegisterChange}
                        disabled={isLoading}
                        className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400 focus:border-blue-500"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="register-nickname" className="text-slate-300">
                        닉네임 <span className="text-red-400">*</span>
                      </Label>
                      <div className="relative">
                        <Input
                          id="register-nickname"
                          name="nickname"
                          type="text"
                          placeholder="닉네임을 입력하세요"
                          value={registerData.nickname}
                          onChange={(e) => {
                            handleRegisterChange(e);
                            if (e.target.value.trim()) {
                              checkNickname(e.target.value);
                            }
                          }}
                          disabled={isLoading}
                          className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400 focus:border-blue-500 pr-10"
                        />
                        {nicknameCheck.status === 'checking' && (
                          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-slate-400" />
                        )}
                        {nicknameCheck.status === 'available' && (
                          <CheckCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-400" />
                        )}
                        {nicknameCheck.status === 'unavailable' && (
                          <XCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-red-400" />
                        )}
                      </div>
                      {nicknameCheck.message && (
                        <p className={`text-sm ${nicknameCheck.status === 'available' ? 'text-green-400' : 'text-red-400'}`}>
                          {nicknameCheck.message}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="register-password" className="text-slate-300">
                      비밀번호 <span className="text-red-400">*</span>
                    </Label>
                    <div className="relative">
                      <Input
                        id="register-password"
                        name="password"
                        type={showPassword ? "text" : "password"}
                        placeholder="비밀번호를 입력하세요"
                        value={registerData.password}
                        onChange={handleRegisterChange}
                        disabled={isLoading}
                        className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400 focus:border-blue-500 pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="register-email" className="text-slate-300">이메일</Label>
                      <Input
                        id="register-email"
                        name="email"
                        type="email"
                        placeholder="이메일을 입력하세요"
                        value={registerData.email}
                        onChange={handleRegisterChange}
                        disabled={isLoading}
                        className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400 focus:border-blue-500"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="register-phone" className="text-slate-300">연락처</Label>
                      <Input
                        id="register-phone"
                        name="phone"
                        type="tel"
                        placeholder="연락처를 입력하세요"
                        value={registerData.phone}
                        onChange={handleRegisterChange}
                        disabled={isLoading}
                        className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400 focus:border-blue-500"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-slate-300">은행 정보</Label>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      <Select value={registerData.bank_name} onValueChange={(value) => 
                        setRegisterData(prev => ({ ...prev, bank_name: value }))
                      }>
                        <SelectTrigger className="bg-slate-700/50 border-slate-600 text-white">
                          <SelectValue placeholder="은행 선택" />
                        </SelectTrigger>
                        <SelectContent className="bg-slate-700 border-slate-600">
                          {banks.map((bank) => (
                            <SelectItem key={bank.id} value={bank.bank_name} className="text-white">
                              {bank.bank_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      
                      <Input
                        name="bank_account"
                        placeholder="계좌번호"
                        value={registerData.bank_account}
                        onChange={handleRegisterChange}
                        disabled={isLoading}
                        className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400 focus:border-blue-500"
                      />
                      
                      <Input
                        name="bank_holder"
                        placeholder="예금주명"
                        value={registerData.bank_holder}
                        onChange={handleRegisterChange}
                        disabled={isLoading}
                        className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400 focus:border-blue-500"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="register-referrer" className="text-slate-300">
                      추천인 <span className="text-red-400">*</span>
                    </Label>
                    <Input
                      id="register-referrer"
                      name="referrer_username"
                      type="text"
                      placeholder="추천인 아이디를 입력하세요"
                      value={registerData.referrer_username}
                      onChange={handleRegisterChange}
                      disabled={isLoading}
                      className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400 focus:border-blue-500"
                    />
                  </div>

                  <Button
                    type="submit"
                    disabled={isLoading || nicknameCheck.status !== 'available'}
                    className="w-full bg-gradient-to-r from-yellow-500 to-orange-600 hover:from-yellow-600 hover:to-orange-700 text-white py-3"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        회원가입 중...
                      </>
                    ) : (
                      '회원가입'
                    )}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>

            {error && (
              <Alert className="border-red-600 bg-red-900/20">
                <AlertDescription className="text-red-400">
                  {error}
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* 하단 정보 */}
        <div className="text-center mt-8 text-sm text-slate-400">
          <p>© 2025 GMS Casino. All rights reserved.</p>
          <p className="mt-2 text-slate-500">안전하고 공정한 게임 환경을 제공합니다.</p>
        </div>
      </div>
    </div>
  );
}

// Default export 추가
export default UserLogin;