import { useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Card, CardContent } from "../ui/card";
import { Settings } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { toast } from "sonner@2.0.3";

interface PasswordChangeSectionProps {
  userId: string;
}

export function PasswordChangeSection({ userId }: PasswordChangeSectionProps) {
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [passwordLoading, setPasswordLoading] = useState(false);

  const changePassword = async () => {
    if (!newPassword || !confirmPassword) {
      toast.error('비밀번호를 입력해주세요.');
      return;
    }

    if (newPassword.length < 4) {
      toast.error('비밀번호는 최소 4자 이상이어야 합니다.');
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error('비밀번호가 일치하지 않습니다.');
      return;
    }

    try {
      setPasswordLoading(true);

      // users 테이블의 password_hash 업데이트 (평문 저장)
      const { error: updateError } = await supabase
        .from('users')
        .update({
          password_hash: newPassword,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);

      if (updateError) {
        throw updateError;
      }

      toast.success('비밀번호가 변경되었습니다.');
      setNewPassword('');
      setConfirmPassword('');

    } catch (error: any) {
      console.error('비밀번호 변경 오류:', error);
      toast.error('비밀번호 변경에 실패했습니다.');
    } finally {
      setPasswordLoading(false);
    }
  };

  return (
    <div>
      <h3 className="flex items-center gap-2 mb-3">
        <Settings className="h-3.5 w-3.5 text-red-400" />
        <span className="text-xs">비밀번호 변경</span>
      </h3>
      <Card className="bg-white/5 border-white/10">
        <CardContent className="p-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="newPassword" className="text-xs">새 비밀번호</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="새 비밀번호 입력 (최소 4자)"
                className="bg-white/5 border-white/10 text-xs h-9"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-xs">비밀번호 확인</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="비밀번호 재입력"
                className="bg-white/5 border-white/10 text-xs h-9"
              />
            </div>
          </div>
          <div className="flex justify-end mt-4">
            <Button
              onClick={changePassword}
              disabled={passwordLoading || !newPassword || !confirmPassword}
              className="bg-gradient-to-r from-red-500 to-pink-600 hover:from-red-600 hover:to-pink-700 text-white px-4 py-2 text-xs h-9"
            >
              {passwordLoading ? '변경 중...' : '비밀번호 변경'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
