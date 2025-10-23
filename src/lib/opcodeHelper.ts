/**
 * OPCODE 조회 헬퍼 함수
 * 관리자 권한에 따라 올바른 OPCODE와 Secret Key를 조회합니다.
 */

import { supabase } from "./supabase";
import { Partner } from "../types";

export interface OpcodeInfo {
  opcode: string;
  secretKey: string;
  token: string;
  partnerId: string;
  partnerName: string;
}

export interface MultipleOpcodeInfo {
  opcodes: OpcodeInfo[];
  isSystemAdmin: boolean;
}

/**
 * 관리자의 권한에 따라 사용 가능한 OPCODE 조회
 * 
 * @param admin - 현재 로그인한 관리자 정보
 * @returns 시스템관리자의 경우 본인 + 모든 대본사 OPCODE 배열, 그 외는 단일 OPCODE
 */
export async function getAdminOpcode(admin: Partner): Promise<OpcodeInfo | MultipleOpcodeInfo> {
  console.log('🔍 getAdminOpcode 호출:', {
    id: admin.id,
    username: admin.username,
    partner_type: admin.partner_type,
    level: admin.level,
    opcode: admin.opcode,
    has_opcode: !!admin.opcode,
    has_secret_key: !!admin.secret_key,
    has_token: !!admin.token,
    has_api_token: !!admin.api_token
  });

  // 1. 시스템관리자: 본인 OPCODE + 모든 대본사 OPCODE 목록 반환
  if (admin.partner_type === 'system_admin') {
    const opcodeList: OpcodeInfo[] = [];

    // token과 api_token 중 하나라도 있으면 사용
    const tokenValue = admin.token || admin.api_token;

    // 1-1. 시스템관리자 본인의 OPCODE 추가 (있는 경우)
    if (admin.opcode && admin.secret_key && tokenValue) {
      opcodeList.push({
        opcode: admin.opcode,
        secretKey: admin.secret_key,
        token: tokenValue,
        partnerId: admin.id,
        partnerName: admin.name || admin.nickname || '시스템관리자'
      });
      console.log('✅ 시스템관리자 본인 OPCODE 추가:', admin.opcode);
    } else {
      console.warn('⚠️ 시스템관리자 OPCODE 정보 불완전:', {
        opcode: admin.opcode,
        secret_key: admin.secret_key ? '***' : null,
        token: tokenValue ? '***' : null
      });
    }

    // 1-2. 모든 대본사 OPCODE 추가
    const { data: masterPartners, error } = await supabase
      .from('partners')
      .select('id, username, nickname, opcode, secret_key, api_token')
      .eq('partner_type', 'head_office')
      .not('opcode', 'is', null)
      .not('secret_key', 'is', null)
      .not('api_token', 'is', null);

    if (error) {
      console.error('❌ 대본사 OPCODE 조회 오류:', error);
    }

    if (masterPartners && masterPartners.length > 0) {
      masterPartners.forEach((p: any) => {
        opcodeList.push({
          opcode: p.opcode!,
          secretKey: p.secret_key!,
          token: p.api_token!,
          partnerId: p.id,
          partnerName: p.nickname || p.username || `대본사-${p.id.slice(0, 8)}`
        });
      });
      console.log(`✅ 대본사 OPCODE ${masterPartners.length}개 추가`);
    }

    if (opcodeList.length === 0) {
      throw new Error('사용 가능한 OPCODE가 없습니다. 시스템관리자 또는 대본사에 OPCODE를 설정해주세요.');
    }

    console.log(`📊 시스템관리자 총 ${opcodeList.length}개 OPCODE 사용 가능`);

    return {
      opcodes: opcodeList,
      isSystemAdmin: true
    };
  }

  // 2. 대본사: 자신의 OPCODE 반환
  if (admin.partner_type === 'head_office') {
    const tokenValue = admin.token || admin.api_token;
    
    if (!admin.opcode || !admin.secret_key || !tokenValue) {
      throw new Error('대본사 계정에 OPCODE/Token이 설정되지 않았습니다.');
    }

    console.log('✅ 대본사 OPCODE 조회:', admin.opcode);

    return {
      opcode: admin.opcode,
      secretKey: admin.secret_key,
      token: tokenValue,
      partnerId: admin.id,
      partnerName: admin.nickname || admin.username || '내 조직'
    };
  }

  // 3. 본사/부본사/총판/매장: 상위 대본사 OPCODE 조회
  // parent_chain의 첫 번째 ID가 대본사 ID
  const parentChain = admin.parent_chain || [];
  
  if (parentChain.length === 0) {
    // parent_chain이 없는 경우 parent_id로 대본사 찾기
    console.log('🔍 parent_chain 없음, parent_id로 대본사 찾기 시작:', {
      admin_id: admin.id,
      admin_username: admin.username,
      admin_type: admin.partner_type,
      parent_id: admin.parent_id
    });

    if (!admin.parent_id) {
      throw new Error(`${admin.partner_type}는 상위 파트너가 필요합니다. parent_id가 설정되지 않았습니다.`);
    }

    let currentPartnerId = admin.parent_id;
    let attempts = 0;
    const maxAttempts = 10; // 무한 루프 방지

    while (currentPartnerId && attempts < maxAttempts) {
      console.log(`🔍 [시도 ${attempts + 1}] 파트너 조회:`, currentPartnerId);

      const { data: parentPartner, error } = await supabase
        .from('partners')
        .select('id, nickname, username, partner_type, level, opcode, secret_key, api_token, parent_id')
        .eq('id', currentPartnerId)
        .single();

      console.log(`📊 [시도 ${attempts + 1}] 조회 결과:`, {
        found: !!parentPartner,
        error: error?.message,
        partner_type: parentPartner?.partner_type,
        level: parentPartner?.level,
        has_opcode: !!parentPartner?.opcode,
        has_secret_key: !!parentPartner?.secret_key,
        has_api_token: !!parentPartner?.api_token,
        parent_id: parentPartner?.parent_id
      });

      if (error) {
        console.error('❌ 상위 파트너 조회 DB 오류:', error);
        throw new Error(`상위 파트너 조회 실패: ${error.message}`);
      }

      if (!parentPartner) {
        throw new Error(`상위 파트너를 찾을 수 없습니다 (ID: ${currentPartnerId})`);
      }

      if (parentPartner.partner_type === 'head_office') {
        const tokenValue = (parentPartner as any).api_token;
        
        if (!parentPartner.opcode || !parentPartner.secret_key || !tokenValue) {
          console.error('❌ 대본사 OPCODE 정보 부족:', {
            partner_id: parentPartner.id,
            username: (parentPartner as any).username,
            has_opcode: !!parentPartner.opcode,
            has_secret_key: !!parentPartner.secret_key,
            has_api_token: !!tokenValue
          });
          throw new Error(`상위 대본사(${(parentPartner as any).username})에 OPCODE/Token이 설정되지 않았습니다.`);
        }

        console.log('✅ 상위 대본사 OPCODE 조회 성공:', {
          partner_id: parentPartner.id,
          username: (parentPartner as any).username,
          opcode: parentPartner.opcode
        });

        return {
          opcode: parentPartner.opcode,
          secretKey: parentPartner.secret_key,
          token: tokenValue,
          partnerId: parentPartner.id,
          partnerName: (parentPartner as any).nickname || (parentPartner as any).username || '상위 대본사'
        };
      }

      console.log(`⬆️ [시도 ${attempts + 1}] ${parentPartner.partner_type}는 대본사 아님, 상위로 이동`);
      currentPartnerId = parentPartner.parent_id || null;
      attempts++;
    }

    if (attempts >= maxAttempts) {
      throw new Error('상위 대본사 조회 시도 횟수 초과 (최대 10회)');
    }

    throw new Error('상위 대본사를 찾을 수 없습니다. 파트너 계층 구조를 확인해주세요.');
  }

  // parent_chain이 있는 경우
  const masterPartnerId = parentChain[0];
  const { data: masterPartner, error } = await supabase
    .from('partners')
    .select('id, nickname, opcode, secret_key, api_token')
    .eq('id', masterPartnerId)
    .single();

  if (error || !masterPartner) {
    console.error('상위 대본사 조회 오류:', error);
    throw new Error('상위 대본사 정보를 찾을 수 없습니다.');
  }

  const tokenValue = (masterPartner as any).api_token;

  if (!masterPartner.opcode || !masterPartner.secret_key || !tokenValue) {
    throw new Error('상위 대본사에 OPCODE/Token이 설정되지 않았습니다.');
  }

  console.log('✅ 상위 대본사 OPCODE 조회 (parent_chain):', masterPartner.opcode);

  return {
    opcode: masterPartner.opcode,
    secretKey: masterPartner.secret_key,
    token: tokenValue,
    partnerId: masterPartner.id,
    partnerName: (masterPartner as any).nickname || '상위 대본사'
  };
}

/**
 * 시스템관리자인지 확인하는 헬퍼 함수
 */
export function isSystemAdmin(admin: Partner): boolean {
  return admin.partner_type === 'system_admin';
}

/**
 * 대본사인지 확인하는 헬퍼 함수
 */
export function isMasterPartner(admin: Partner): boolean {
  return admin.partner_type === 'head_office';
}

/**
 * MultipleOpcodeInfo 타입 가드
 */
export function isMultipleOpcode(info: OpcodeInfo | MultipleOpcodeInfo): info is MultipleOpcodeInfo {
  return 'opcodes' in info && 'isSystemAdmin' in info;
}