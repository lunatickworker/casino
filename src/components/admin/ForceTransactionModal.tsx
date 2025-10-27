import { useState } from "react";
import { Search, Trash2, TrendingUp, TrendingDown, Check, ChevronsUpDown } from "lucide-react";
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

  // 금액 단축 버튼 (포인트 모달과 동일하게 4개씩)
  const amountShortcuts = [
    1000,
    3000, 
    5000,
    10000,
    30000,
    50000,
    100000,
    300000,
    500000,
    1000000
  ];

  // 선택된 대상: prop으로 받은 것 우선, 없으면 내부 state 사용
  const selectedTarget = propSelectedTarget || targets.find(t => t.id === selectedTargetId);
  const currentBalance = selectedTarget ? parseFloat(selectedTarget.balance?.toString() || '0') : 0;
  const isTargetFixed = !!propSelectedTarget;

  // 금액 단축 버튼 클릭 (누적 더하기)
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
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {type === 'deposit' ? (
              <>
                <TrendingUp className="h-5 w-5 text-emerald-500" />
                강제 입금
              </>
            ) : (
              <>
                <TrendingDown className="h-5 w-5 text-rose-500" />
                강제 출금
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {targetType === 'user' ? '회원' : '파트너'}의 잔액을 직접 조정합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 py-4">
          {/* 거래 유형 */}
          <div className="grid gap-2">
            <Label htmlFor="force-transaction-type">거래 유형</Label>
            <Select value={type} onValueChange={(v: 'deposit' | 'withdrawal') => onTypeChange(v)}>
              <SelectTrigger id="force-transaction-type" className="input-premium h-10">
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
            <div className="grid gap-2">
              <Label htmlFor="force-transaction-target-search">{targetType === 'user' ? '회원' : '파트너'} 선택</Label>
              <Popover open={searchOpen} onOpenChange={setSearchOpen}>
                <PopoverTrigger asChild>
                  <Button
                    id="force-transaction-target-search"
                    variant="outline"
                    role="combobox"
                    aria-expanded={searchOpen}
                    className="justify-between input-premium h-10"
                  >
                    {selectedTargetId
                      ? `${selectedTarget?.username} (${selectedTarget?.nickname}) - ${currentBalance.toLocaleString()}원`
                      : `아이디, 닉네임으로 검색`}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[480px] p-0 bg-slate-800 border-slate-700">
                  <Command className="bg-slate-800">
                    <CommandInput 
                      placeholder={`아이디, 닉네임으로 검색...`}
                      className="h-9 text-slate-100 placeholder:text-slate-500"
                    />
                    <CommandList>
                      <CommandEmpty className="text-slate-400 py-6 text-center text-sm">
                        {targetType === 'user' ? '회원' : '파트너'}을 찾을 수 없습니다.
                      </CommandEmpty>
                      <CommandGroup className="max-h-64 overflow-auto">
                        {targets.map(t => (
                          <CommandItem
                            key={t.id}
                            value={`${t.username} ${t.nickname}`}
                            onSelect={() => {
                              setSelectedTargetId(t.id);
                              setSearchOpen(false);
                            }}
                            className="flex items-center justify-between cursor-pointer hover:bg-slate-700/50 text-slate-300"
                          >
                            <div className="flex items-center gap-2">
                              <Check
                                className={`mr-2 h-4 w-4 ${
                                  selectedTargetId === t.id ? `opacity-100 ${type === 'deposit' ? 'text-emerald-500' : 'text-rose-500'}` : "opacity-0"
                                }`}
                              />
                              <div>
                                <div className="font-medium text-slate-100">{t.username}</div>
                                <div className="text-xs text-slate-400">{t.nickname}</div>
                              </div>
                            </div>
                            <div className="text-sm">
                              <span className="text-cyan-400 font-mono">{parseFloat(t.balance?.toString() || '0').toLocaleString()}원</span>
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
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="force-transaction-amount">금액</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClearAmount}
                className={`h-7 px-2 text-xs text-slate-400 ${
                  type === 'deposit' 
                    ? 'hover:text-orange-400 hover:bg-orange-500/10' 
                    : 'hover:text-red-400 hover:bg-red-500/10'
                }`}
              >
                전체삭제
              </Button>
            </div>
            <Input
              id="force-transaction-amount"
              name="amount"
              type="number"
              value={amount}
              onChange={(e) => handleAmountChange(e.target.value)}
              className="input-premium"
              placeholder="금액을 입력하세요"
            />
          </div>

          {/* 금액 단축 버튼 */}
          <div className="grid gap-2">
            <Label className="text-slate-400 text-sm">단축 입력 (누적 더하기)</Label>
            <div className="grid grid-cols-4 gap-2">
              {amountShortcuts.map((amt) => (
                <Button
                  key={amt}
                  type="button"
                  variant="outline"
                  onClick={() => handleAmountShortcut(amt)}
                  className={`h-9 transition-all bg-slate-800/50 border-slate-700 text-slate-300 ${
                    type === 'deposit'
                      ? 'hover:bg-orange-500/20 hover:border-orange-500/60 hover:text-orange-400 hover:shadow-[0_0_15px_rgba(251,146,60,0.3)]'
                      : 'hover:bg-red-500/20 hover:border-red-500/60 hover:text-red-400 hover:shadow-[0_0_15px_rgba(239,68,68,0.3)]'
                  }`}
                >
                  +{amt >= 10000 ? `${amt / 10000}만` : `${amt / 1000}천`}
                </Button>
              ))}
            </div>
          </div>

          {/* 전액출금 버튼 (출금 시에만) */}
          {type === 'withdrawal' && selectedTarget && (
            <div className="grid gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleFullWithdrawal}
                className="w-full h-9 bg-red-900/20 border-red-500/50 text-red-400 hover:bg-red-900/40 hover:border-red-500"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                전액출금
              </Button>
            </div>
          )}

          {/* 메모 */}
          <div className="grid gap-2">
            <Label htmlFor="force-transaction-memo">메모</Label>
            <Textarea
              id="force-transaction-memo"
              name="memo"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="메모를 입력하세요 (선택사항)"
              className="input-premium min-h-[80px]"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || (!propSelectedTarget?.id && !selectedTargetId) || !amount || parseFloat(amount) <= 0}
            className={`w-full ${type === 'deposit' ? 'btn-premium-warning' : 'btn-premium-danger'}`}
          >
            {submitting ? '처리 중...' : type === 'deposit' ? '강제 입금' : '강제 출금'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
