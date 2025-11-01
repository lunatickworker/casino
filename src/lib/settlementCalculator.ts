/**
 * 통합 정산 계산 모듈
 * - 모든 정산 관련 로직을 중앙 집중화하여 코드 중복 제거
 * - CommissionSettlement, IntegratedSettlement, Dashboard, PartnerManagement에서 공통 사용
 * - RPC 함수 사용 금지, 직접 SELECT 쿼리만 사용
 */

import { supabase } from './supabase';

/**
 * 파트너 커미션 정보
 */
export interface PartnerCommissionInfo {
  partner_id: string;
  partner_username: string;
  partner_nickname: string;
  partner_level: number;
  commission_rolling: number;
  commission_losing: number;
  withdrawal_fee: number;
  total_bet_amount: number;
  total_loss_amount: number;
  total_withdrawal_amount: number;
  rolling_commission: number;
  losing_commission: number;
  withdrawal_commission: number;
  total_commission: number;
}

/**
 * 정산 요약 정보
 */
export interface SettlementSummary {
  // 내 수입
  myRollingIncome: number;
  myLosingIncome: number;
  myWithdrawalIncome: number;
  myTotalIncome: number;

  // 하위 파트너 지급
  partnerRollingPayments: number;
  partnerLosingPayments: number;
  partnerWithdrawalPayments: number;
  partnerTotalPayments: number;

  // 순수익
  netRollingProfit: number;
  netLosingProfit: number;
  netWithdrawalProfit: number;
  netTotalProfit: number;
}

/**
 * 파트너 지급 상세
 */
export interface PartnerPaymentDetail {
  partner_id: string;
  partner_nickname: string;
  rolling_payment: number;
  losing_payment: number;
  withdrawal_payment: number;
  total_payment: number;
}

/**
 * ⚡ 최적화: 모든 하위 사용자 ID를 일괄 조회 (재귀 제거)
 * @param partnerId 파트너 ID
 * @returns 모든 하위 사용자 ID 배열
 */
export async function getDescendantUserIds(partnerId: string): Promise<string[]> {
  const allUserIds: string[] = [];
  const allPartnerIds: string[] = [partnerId];
  
  // 1단계부터 5단계까지 하위 파트너를 반복문으로 조회 (재귀 제거)
  let currentLevelIds = [partnerId];
  
  for (let level = 0; level < 5; level++) {
    if (currentLevelIds.length === 0) break;
    
    const { data: nextLevelPartners } = await supabase
      .from('partners')
      .select('id')
      .in('parent_id', currentLevelIds);
    
    if (nextLevelPartners && nextLevelPartners.length > 0) {
      const nextIds = nextLevelPartners.map(p => p.id);
      allPartnerIds.push(...nextIds);
      currentLevelIds = nextIds;
    } else {
      break;
    }
  }
  
  // 모든 파트너의 직속 사용자를 한 번에 조회
  if (allPartnerIds.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('id')
      .in('referrer_id', allPartnerIds);
    
    if (users) {
      allUserIds.push(...users.map(u => u.id));
    }
  }

  return allUserIds;
}

/**
 * ⚡ 최적화: 특정 기간의 베팅 통계 조회 (필요한 컬럼만 SELECT)
 * @param userIds 사용자 ID 배열
 * @param startDate 시작 날짜
 * @param endDate 종료 날짜
 * @returns 총 베팅액과 총 손실액
 */
export async function getBettingStats(
  userIds: string[],
  startDate: string,
  endDate: string
): Promise<{ totalBetAmount: number; totalLossAmount: number }> {
  if (userIds.length === 0) {
    return { totalBetAmount: 0, totalLossAmount: 0 };
  }

  // ⚡ 필요한 컬럼만 조회하여 네트워크 부하 감소
  const { data: bettingData, error } = await supabase
    .from('game_records')
    .select('bet_amount, win_amount')
    .in('user_id', userIds)
    .gte('played_at', startDate)
    .lte('played_at', endDate);

  if (error) {
    console.error('베팅 데이터 조회 오류:', error);
    return { totalBetAmount: 0, totalLossAmount: 0 };
  }

  if (!bettingData || bettingData.length === 0) {
    return { totalBetAmount: 0, totalLossAmount: 0 };
  }

  // ⚡ 한 번의 순회로 두 값 모두 계산
  let totalBetAmount = 0;
  let totalLossAmount = 0;
  
  for (const record of bettingData) {
    const bet = record.bet_amount || 0;
    const win = record.win_amount || 0;
    totalBetAmount += bet;
    const loss = bet - win;
    if (loss > 0) {
      totalLossAmount += loss;
    }
  }

  return { totalBetAmount, totalLossAmount };
}

/**
 * 특정 기간의 출금 총액 조회
 * @param userIds 사용자 ID 배열
 * @param startDate 시작 날짜
 * @param endDate 종료 날짜
 * @returns 총 출금액
 */
export async function getWithdrawalAmount(
  userIds: string[],
  startDate: string,
  endDate: string
): Promise<number> {
  if (userIds.length === 0) {
    return 0;
  }

  const { data: withdrawalData, error } = await supabase
    .from('transactions')
    .select('amount')
    .in('user_id', userIds)
    .eq('transaction_type', 'withdrawal')
    .eq('status', 'approved')
    .gte('created_at', startDate)
    .lte('created_at', endDate);

  if (error) {
    console.error('출금 데이터 조회 오류:', error);
    return 0;
  }

  if (!withdrawalData) {
    return 0;
  }

  return withdrawalData.reduce((sum, tx) => sum + (tx.amount || 0), 0);
}

/**
 * 파트너의 커미션 계산 (직속 하위 정산 방식)
 * @param partnerId 파트너 ID
 * @param partner 파트너 정보 (commission_rolling, commission_losing, withdrawal_fee 포함)
 * @param startDate 시작 날짜
 * @param endDate 종료 날짜
 * @returns 커미션 상세 정보
 */
export async function calculatePartnerCommission(
  partnerId: string,
  partner: {
    username: string;
    nickname: string;
    level: number;
    commission_rolling: number;
    commission_losing: number;
    withdrawal_fee: number;
  },
  startDate: string,
  endDate: string
): Promise<PartnerCommissionInfo> {
  try {
    // 모든 하위 사용자 ID 조회
    const descendantUserIds = await getDescendantUserIds(partnerId);

    if (descendantUserIds.length === 0) {
      return {
        partner_id: partnerId,
        partner_username: partner.username,
        partner_nickname: partner.nickname,
        partner_level: partner.level,
        commission_rolling: partner.commission_rolling,
        commission_losing: partner.commission_losing,
        withdrawal_fee: partner.withdrawal_fee,
        total_bet_amount: 0,
        total_loss_amount: 0,
        total_withdrawal_amount: 0,
        rolling_commission: 0,
        losing_commission: 0,
        withdrawal_commission: 0,
        total_commission: 0
      };
    }

    // 베팅 통계 조회
    const { totalBetAmount, totalLossAmount } = await getBettingStats(
      descendantUserIds,
      startDate,
      endDate
    );

    // 출금 총액 조회
    const totalWithdrawalAmount = await getWithdrawalAmount(
      descendantUserIds,
      startDate,
      endDate
    );

    // 수수료 계산
    const rollingCommission = totalBetAmount * (partner.commission_rolling / 100);
    const losingCommission = totalLossAmount * (partner.commission_losing / 100);
    const withdrawalCommission = totalWithdrawalAmount * (partner.withdrawal_fee / 100);
    const totalCommission = rollingCommission + losingCommission + withdrawalCommission;

    return {
      partner_id: partnerId,
      partner_username: partner.username,
      partner_nickname: partner.nickname,
      partner_level: partner.level,
      commission_rolling: partner.commission_rolling,
      commission_losing: partner.commission_losing,
      withdrawal_fee: partner.withdrawal_fee,
      total_bet_amount: totalBetAmount,
      total_loss_amount: totalLossAmount,
      total_withdrawal_amount: totalWithdrawalAmount,
      rolling_commission: rollingCommission,
      losing_commission: losingCommission,
      withdrawal_commission: withdrawalCommission,
      total_commission: totalCommission
    };
  } catch (error) {
    console.error('파트너 커미션 계산 실패:', error);
    return {
      partner_id: partnerId,
      partner_username: partner.username,
      partner_nickname: partner.nickname,
      partner_level: partner.level,
      commission_rolling: partner.commission_rolling,
      commission_losing: partner.commission_losing,
      withdrawal_fee: partner.withdrawal_fee,
      total_bet_amount: 0,
      total_loss_amount: 0,
      total_withdrawal_amount: 0,
      rolling_commission: 0,
      losing_commission: 0,
      withdrawal_commission: 0,
      total_commission: 0
    };
  }
}

/**
 * ⚡ 최적화: 직속 하위 파트너들의 커미션을 병렬 계산
 * @param parentId 상위 파트너 ID
 * @param startDate 시작 날짜
 * @param endDate 종료 날짜
 * @returns 파트너별 커미션 배열
 */
export async function calculateChildPartnersCommission(
  parentId: string,
  startDate: string,
  endDate: string
): Promise<PartnerCommissionInfo[]> {
  try {
    // 직속 하위 파트너 목록 조회
    const { data: childPartners, error } = await supabase
      .from('partners')
      .select('id, username, nickname, level, commission_rolling, commission_losing, withdrawal_fee')
      .eq('parent_id', parentId)
      .order('level')
      .order('nickname');

    if (error) {
      console.error('하위 파트너 조회 오류:', error);
      return [];
    }

    if (!childPartners || childPartners.length === 0) {
      return [];
    }

    // ⚡ 병렬 처리: 모든 파트너의 커미션을 동시에 계산
    const commissionsPromises = childPartners.map(partner =>
      calculatePartnerCommission(
        partner.id,
        partner,
        startDate,
        endDate
      )
    );

    const commissionsData = await Promise.all(commissionsPromises);

    return commissionsData;
  } catch (error) {
    console.error('하위 파트너 커미션 계산 실패:', error);
    return [];
  }
}

/**
 * 내 총 수입 계산
 * @param partnerId 파트너 ID
 * @param commissionRates 내 커미션율 { rolling, losing, withdrawal }
 * @param startDate 시작 날짜
 * @param endDate 종료 날짜
 * @returns 롤링/루징/출금 수입과 총합
 */
export async function calculateMyIncome(
  partnerId: string,
  commissionRates: {
    rolling: number;
    losing: number;
    withdrawal: number;
  },
  startDate: string,
  endDate: string
): Promise<{
  rolling: number;
  losing: number;
  withdrawal: number;
  total: number;
}> {
  try {
    // 모든 하위 사용자 ID 조회
    const descendantUserIds = await getDescendantUserIds(partnerId);

    if (descendantUserIds.length === 0) {
      return { rolling: 0, losing: 0, withdrawal: 0, total: 0 };
    }

    // 베팅 통계 조회
    const { totalBetAmount, totalLossAmount } = await getBettingStats(
      descendantUserIds,
      startDate,
      endDate
    );

    // 출금 총액 조회
    const totalWithdrawalAmount = await getWithdrawalAmount(
      descendantUserIds,
      startDate,
      endDate
    );

    // 내 수수료율로 계산
    const rollingIncome = totalBetAmount * (commissionRates.rolling / 100);
    const losingIncome = totalLossAmount * (commissionRates.losing / 100);
    const withdrawalIncome = totalWithdrawalAmount * (commissionRates.withdrawal / 100);

    return {
      rolling: rollingIncome,
      losing: losingIncome,
      withdrawal: withdrawalIncome,
      total: rollingIncome + losingIncome + withdrawalIncome
    };
  } catch (error) {
    console.error('내 수입 계산 실패:', error);
    return { rolling: 0, losing: 0, withdrawal: 0, total: 0 };
  }
}

/**
 * ⚡ 최적화: 하위 파트너 지급액을 병렬 계산
 * @param parentId 상위 파트너 ID
 * @param startDate 시작 날짜
 * @param endDate 종료 날짜
 * @returns 파트너별 지급 상세 및 총합
 */
export async function calculatePartnerPayments(
  parentId: string,
  startDate: string,
  endDate: string
): Promise<{
  totalRolling: number;
  totalLosing: number;
  totalWithdrawal: number;
  total: number;
  details: PartnerPaymentDetail[];
}> {
  try {
    // 직속 하위 파트너 조회
    const { data: childPartners, error } = await supabase
      .from('partners')
      .select('id, nickname, commission_rolling, commission_losing, withdrawal_fee')
      .eq('parent_id', parentId);

    if (error) {
      console.error('하위 파트너 조회 오류:', error);
      return {
        totalRolling: 0,
        totalLosing: 0,
        totalWithdrawal: 0,
        total: 0,
        details: []
      };
    }

    if (!childPartners || childPartners.length === 0) {
      return {
        totalRolling: 0,
        totalLosing: 0,
        totalWithdrawal: 0,
        total: 0,
        details: []
      };
    }

    // ⚡ 병렬 처리: 모든 파트너의 지급액을 동시에 계산
    const paymentPromises = childPartners.map(partner =>
      calculatePartnerPayment(partner, startDate, endDate)
    );

    const details = await Promise.all(paymentPromises);

    // 총합 계산
    let totalRolling = 0;
    let totalLosing = 0;
    let totalWithdrawal = 0;

    for (const payment of details) {
      totalRolling += payment.rolling_payment;
      totalLosing += payment.losing_payment;
      totalWithdrawal += payment.withdrawal_payment;
    }

    return {
      totalRolling,
      totalLosing,
      totalWithdrawal,
      total: totalRolling + totalLosing + totalWithdrawal,
      details
    };
  } catch (error) {
    console.error('파트너 지급 계산 실패:', error);
    return {
      totalRolling: 0,
      totalLosing: 0,
      totalWithdrawal: 0,
      total: 0,
      details: []
    };
  }
}

/**
 * 특정 파트너의 지급액 계산
 */
async function calculatePartnerPayment(
  partner: {
    id: string;
    nickname: string;
    commission_rolling: number;
    commission_losing: number;
    withdrawal_fee: number;
  },
  startDate: string,
  endDate: string
): Promise<PartnerPaymentDetail> {
  try {
    // 해당 파트너의 모든 하위 사용자 조회
    const descendantUserIds = await getDescendantUserIds(partner.id);

    if (descendantUserIds.length === 0) {
      return {
        partner_id: partner.id,
        partner_nickname: partner.nickname,
        rolling_payment: 0,
        losing_payment: 0,
        withdrawal_payment: 0,
        total_payment: 0
      };
    }

    // 베팅 통계 조회
    const { totalBetAmount, totalLossAmount } = await getBettingStats(
      descendantUserIds,
      startDate,
      endDate
    );

    // 출금 총액 조회
    const totalWithdrawalAmount = await getWithdrawalAmount(
      descendantUserIds,
      startDate,
      endDate
    );

    // 파트너 수수료율로 계산
    const rollingPayment = totalBetAmount * (partner.commission_rolling / 100);
    const losingPayment = totalLossAmount * (partner.commission_losing / 100);
    const withdrawalPayment = totalWithdrawalAmount * (partner.withdrawal_fee / 100);

    return {
      partner_id: partner.id,
      partner_nickname: partner.nickname,
      rolling_payment: rollingPayment,
      losing_payment: losingPayment,
      withdrawal_payment: withdrawalPayment,
      total_payment: rollingPayment + losingPayment + withdrawalPayment
    };
  } catch (error) {
    console.error('파트너 지급 계산 실패:', error);
    return {
      partner_id: partner.id,
      partner_nickname: partner.nickname,
      rolling_payment: 0,
      losing_payment: 0,
      withdrawal_payment: 0,
      total_payment: 0
    };
  }
}

/**
 * 통합 정산 계산 (내 수입 - 하위 파트너 지급 = 순수익)
 * @param partnerId 파트너 ID
 * @param commissionRates 내 커미션율
 * @param startDate 시작 날짜
 * @param endDate 종료 날짜
 * @returns 통합 정산 요약
 */
export async function calculateIntegratedSettlement(
  partnerId: string,
  commissionRates: {
    rolling: number;
    losing: number;
    withdrawal: number;
  },
  startDate: string,
  endDate: string
): Promise<SettlementSummary> {
  try {
    // 내 총 수입 계산
    const myIncome = await calculateMyIncome(partnerId, commissionRates, startDate, endDate);

    // 하위 파트너 지급 계산
    const payments = await calculatePartnerPayments(partnerId, startDate, endDate);

    // 순수익 계산
    return {
      myRollingIncome: myIncome.rolling,
      myLosingIncome: myIncome.losing,
      myWithdrawalIncome: myIncome.withdrawal,
      myTotalIncome: myIncome.total,
      partnerRollingPayments: payments.totalRolling,
      partnerLosingPayments: payments.totalLosing,
      partnerWithdrawalPayments: payments.totalWithdrawal,
      partnerTotalPayments: payments.total,
      netRollingProfit: myIncome.rolling - payments.totalRolling,
      netLosingProfit: myIncome.losing - payments.totalLosing,
      netWithdrawalProfit: myIncome.withdrawal - payments.totalWithdrawal,
      netTotalProfit: myIncome.total - payments.total
    };
  } catch (error) {
    console.error('통합 정산 계산 실패:', error);
    return {
      myRollingIncome: 0,
      myLosingIncome: 0,
      myWithdrawalIncome: 0,
      myTotalIncome: 0,
      partnerRollingPayments: 0,
      partnerLosingPayments: 0,
      partnerWithdrawalPayments: 0,
      partnerTotalPayments: 0,
      netRollingProfit: 0,
      netLosingProfit: 0,
      netWithdrawalProfit: 0,
      netTotalProfit: 0
    };
  }
}

/**
 * 만충금 계산 (pending deposits)
 * @param userIds 사용자 ID 배열
 * @param startDate 시작 날짜
 * @param endDate 종료 날짜
 * @returns 대기 중인 입금 총액
 */
export async function calculatePendingDeposits(
  userIds: string[],
  startDate: string,
  endDate: string
): Promise<number> {
  if (userIds.length === 0) {
    return 0;
  }

  const { data: pendingData, error } = await supabase
    .from('transactions')
    .select('amount')
    .eq('transaction_type', 'deposit')
    .eq('status', 'pending')
    .in('user_id', userIds)
    .gte('created_at', startDate)
    .lte('created_at', endDate);

  if (error) {
    console.error('만충금 조회 오류:', error);
    return 0;
  }

  if (!pendingData) {
    return 0;
  }

  return pendingData.reduce((sum, t) => sum + Number(t.amount), 0);
}

/**
 * 이번 달 커미션 계산
 * @param partnerId 파트너 ID
 * @param commissionRates 커미션율
 * @returns 이번 달 총 커미션
 */
export async function calculateMonthlyCommission(
  partnerId: string,
  commissionRates: {
    rolling: number;
    losing: number;
    withdrawal: number;
  }
): Promise<number> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const income = await calculateMyIncome(
    partnerId,
    commissionRates,
    monthStart.toISOString(),
    monthEnd.toISOString()
  );

  return income.total;
}
