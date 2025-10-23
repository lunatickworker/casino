import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { ButtonLoading } from "../common/LoadingSpinner";
import { useAuth } from "../../hooks/useAuth";
import { toast } from "sonner@2.0.3";
import { Shield } from "lucide-react";

interface AdminLoginProps {
  onLoginSuccess: () => void;
}

export function AdminLogin({ onLoginSuccess }: AdminLoginProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!username.trim() || !password.trim()) {
      toast.error("아이디와 비밀번호를 입력해주세요.");
      return;
    }

    setLoading(true);
    try {
      const result = await login(username.trim(), password);
      
      if (result.success) {
        toast.success("로그인되었습니다.");
        onLoginSuccess();
      } else {
        toast.error(result.error || "로그인에 실패했습니다.");
      }
    } catch (error) {
      toast.error("로그인 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-4">
      <Card className="w-full max-w-md bg-slate-800/50 border-slate-700 shadow-2xl">
        <CardHeader className="space-y-1 text-center">
          <div className="flex justify-center mb-4">
            <Shield className="h-12 w-12 text-blue-400" />
          </div>
          <CardTitle className="text-2xl font-bold text-white">GMS 관리자</CardTitle>
          <CardDescription className="text-slate-400">
            게임 관리 시스템
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-white">관리자 로그인</h3>
              <p className="text-sm text-slate-400">계정 정보를 입력하여 로그인하세요</p>
            </div>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username" className="text-white">아이디</Label>
                <Input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="관리자 아이디를 입력하세요"
                  className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400"
                  disabled={loading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-white">비밀번호</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="비밀번호를 입력하세요"
                  className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400"
                  disabled={loading}
                />
              </div>
              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-slate-700 hover:bg-slate-600"
              >
                {loading ? (
                  <ButtonLoading>로그인</ButtonLoading>
                ) : (
                  "로그인"
                )}
              </Button>
            </form>
          </div>
        </CardContent>
        
        {/* 시스템 정보 */}
        <div className="px-6 pb-6 text-center text-xs text-slate-500 space-y-1">
          <p>GMS v1.0 | 통합 게임 관리 시스템</p>
          <p>7단계 권한 체계 | 실시간 데이터 동기화</p>
        </div>
      </Card>
    </div>
  );
}

// Default export 추가
export default AdminLogin;