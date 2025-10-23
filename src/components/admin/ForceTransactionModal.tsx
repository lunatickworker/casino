import { useState } from "react";
import { Search, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "../ui/command";
import { AdminDialog as Dialog, AdminDialogContent as DialogContent, AdminDialogDescription as DialogDescription, AdminDialogFooter as DialogFooter, AdminDialogHeader as DialogHeader, AdminDialogTitle as DialogTitle } from "./AdminDialog";
import { toast } from "sonner@2.0.3";

interface ForceTransactionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: 'deposit' | 'withdrawal';
  targetType: 'user' | 'partner';
  selectedTarget?: {
    id: string;
    username: string;
    nickname: string;
    balance: number | string;
  } | null;
  targets?: Array<{
    id: string;
    username: string;
    nickname: string;
    balance: number | string;
  }>;
  onSubmit: (data: {
    targetId: string;
    type: 'deposit' | 'withdrawal';
    amount: number;
    memo: string;
  }) => Promise<void>;
  onTypeChange: (type: 'deposit' | 'withdrawal') => void;
}

export function ForceTransactionModal({
  open,
  onOpenChange,
  type,
  targetType,
  selectedTarget: propSelectedTarget,
  targets = [],
  onSubmit,
  onTypeChange
}: ForceTransactionModalProps) {
  const [selectedTargetId, setSelectedTargetId] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // 금액 단축 버튼
  const amountShortcuts = [
    { label: '1천', value: 1000 },
    { label: '3천', value: 3000 },
    { label: '5천', value: 5000 },
    { label: '1만', value: 10000 },
    { label: '3만', value: 30000 },
    { label: '5만', value: 50000 },
    { label: '100만', value: 1000000 },
    { label: '300만', value: 3000000 },
    { label: '500만', value: 5000000 },
    { label: '1000만', value: 10000000 }
  ];

  // 선택된 대상: prop으로 받은 것 우선, 없으면 내부 state 사용
  const selectedTarget = propSelectedTarget || targets.find(t => t.id === selectedTargetId);
  const currentBalance = selectedTarget ? parseFloat(selectedTarget.balance?.toString() || '0') : 0;
  const isTargetFixed = !!propSelectedTarget;

  // 금액 단축 버튼 클릭
  const handleAmountShortcut = (value: number) => {
    const currentAmount = parseFloat(amount || '0');
    const newAmount = currentAmount + value;

    // 출금 시 보유금 검증
    if (type === 'withdrawal' && selectedTargetId) {
      if (newAmount > currentBalance) {
        toast.error(`출금 금액이 보유금(${currentBalance.toLocaleString()}원)을 초과할 수 없습니다.`);
        setAmount(currentBalance.toString());
        return;
      }
    }

    setAmount(newAmount.toString());
  };

  // 금액 입력 처리
  const handleAmountChange = (value: string) => {
    const inputAmount = parseFloat(value || '0');

    // 출금 시 보유금 검증
    if (type === 'withdrawal' && selectedTargetId) {
      if (inputAmount > currentBalance) {
        toast.error(`출금 금액이 보유금(${currentBalance.toLocaleString()}원)을 초과할 수 없습니다.`);
        setAmount(currentBalance.toString());
        return;
      }
    }

    setAmount(value);
  };

  // 전액삭제
  const handleClearAmount = () => {
    setAmount('0');
  };

  // 전액출금
  const handleFullWithdrawal = () => {
    if (selectedTarget && type === 'withdrawal') {
      setAmount(currentBalance.toString());
    }
  };

  // 실행
  const handleSubmit = async () => {
    const targetId = propSelectedTarget?.id || selectedTargetId;
    
    if (!targetId) {
      toast.error(`${targetType === 'user' ? '회원' : '파트너'}를 선택해주세요.`);
      return;
    }

    const amountNum = parseFloat(amount || '0');
    if (amountNum <= 0) {
      toast.error('금액을 입력해주세요.');
      return;
    }

    if (type === 'withdrawal' && amountNum > currentBalance) {
      toast.error(`출금 금액이 보유금(${currentBalance.toLocaleString()}원)을 초과할 수 없습니다.`);
      return;
    }

    try {
      setSubmitting(true);
      await onSubmit({
        targetId,
        type,
        amount: amountNum,
        memo
      });

      // 초기화
      if (!isTargetFixed) {
        setSelectedTargetId('');
      }
      setAmount('');
      setMemo('');
      onOpenChange(false);
    } catch (error) {
      console.error('강제 입출금 실행 오류:', error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => {
      if (!o) {
        if (!isTargetFixed) {
          setSelectedTargetId('');
        }
        setAmount('');
        setMemo('');
      }
      onOpenChange(o);
    }}>
      <DialogContent className="bg-slate-900 border-slate-700 max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">관리자 강제 입출금</DialogTitle>
          <DialogDescription className="text-slate-400">
            회원의 잔액을 직접 조정합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* 거래 유형 */}
          <div className="space-y-2">
            <Label className="text-slate-300">거래 유형</Label>
            <Select value={type} onValueChange={(v: 'deposit' | 'withdrawal') => onTypeChange(v)}>
              <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                <SelectItem value="deposit">입금</SelectItem>
                <SelectItem value="withdrawal">출금</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 회원 선택 - 고정된 대상이 없을 때만 표시 */}
          {!isTargetFixed && (
            <div className="space-y-2">
              <Label className="text-slate-300">{targetType === 'user' ? '회원' : '파트너'} 선택</Label>
              <Popover open={searchOpen} onOpenChange={setSearchOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between bg-slate-800 border-slate-700 text-white hover:bg-slate-700"
                  >
                    {selectedTargetId
                      ? `${selectedTarget?.nickname} (${selectedTarget?.username})`
                      : `${targetType === 'user' ? '회원' : '파트너'}을 선택하세요`}
                    <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[400px] p-0 bg-slate-800 border-slate-700">
                  <Command className="bg-slate-800">
                    <CommandInput 
                      placeholder={`${targetType === 'user' ? '회원' : '파트너'} 검색...`}
                      className="text-white"
                    />
                    <CommandList>
                      <CommandEmpty className="text-slate-400 py-6 text-center">
                        {targetType === 'user' ? '회원' : '파트너'}을 찾을 수 없습니다.
                      </CommandEmpty>
                      <CommandGroup>
                        {targets.map(t => (
                          <CommandItem
                            key={t.id}
                            value={`${t.nickname} ${t.username} ${t.id}`}
                            onSelect={() => {
                              setSelectedTargetId(t.id);
                              setSearchOpen(false);
                            }}
                            className="text-white hover:bg-slate-700 cursor-pointer"
                          >
                            <div className="flex flex-col w-full">
                              <div className="flex items-center justify-between">
                                <span className="font-medium">{t.nickname}</span>
                                <span className="text-sm text-slate-400">({t.username})</span>
                              </div>
                              <div className="text-sm text-cyan-400 mt-1">
                                잔액: {parseFloat(t.balance?.toString() || '0').toLocaleString()}원
                              </div>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          )}

          {/* 선택된 회원 정보 */}
          {selectedTarget && (
            <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-700">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-slate-400">선택된 {targetType === 'user' ? '회원' : '파트너'}</span>
                <span className="text-cyan-400 font-medium">{selectedTarget.nickname}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">현재 보유금</span>
                <span className="font-mono text-cyan-400">
                  {currentBalance.toLocaleString()}원
                </span>
              </div>
            </div>
          )}

          {/* 금액 */}
          <div className="space-y-2">
            <Label className="text-slate-300">금액</Label>
            <Input
              type="text"
              value={amount}
              onChange={(e) => handleAmountChange(e.target.value)}
              placeholder="금액을 입력하세요"
              className="bg-slate-800 border-slate-700 text-white"
            />

            {/* 금액 단축 버튼 */}
            <div className="grid grid-cols-5 gap-2">
              {amountShortcuts.map(shortcut => (
                <Button
                  key={shortcut.value}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleAmountShortcut(shortcut.value)}
                  className="bg-slate-700 border-slate-600 text-white hover:bg-slate-600 text-xs h-8"
                >
                  {shortcut.label}
                </Button>
              ))}
            </div>

            {/* 전액삭제 / 전액출금 */}
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleClearAmount}
                className="bg-red-900/20 border-red-500 text-red-400 hover:bg-red-900/40"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                전액삭제
              </Button>
              {type === 'withdrawal' && selectedTarget && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleFullWithdrawal}
                  className="bg-orange-900/20 border-orange-500 text-orange-400 hover:bg-orange-900/40"
                >
                  전액출금
                </Button>
              )}
            </div>
          </div>

          {/* 메모 */}
          <div className="space-y-2">
            <Label className="text-slate-300">메모</Label>
            <Textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="메모를 입력하세요 (선택사항)"
              className="bg-slate-800 border-slate-700 text-white resize-none"
              rows={3}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            className="border-slate-600 hover:bg-slate-700 text-white"
          >
            취소
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || (!propSelectedTarget?.id && !selectedTargetId) || !amount || parseFloat(amount) <= 0}
            className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white"
          >
            {submitting ? '처리중...' : '실행'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}