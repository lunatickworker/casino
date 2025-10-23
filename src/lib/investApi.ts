// ✅ 검증된 MD5 해시 함수 (UTF-8 인코딩 포함)
// Guidelines 요구사항: "utf-8 함수로 변환 후 md5(signature) 생성"
function md5Hash(input: string): string {
  // UTF-8 인코딩: TextEncoder 사용 (브라우저 네이티브, 정확함)
  const utf8Bytes = new TextEncoder().encode(input);
  // 헬퍼 함수들
  const rotateLeft = (n: number, s: number) => (n << s) | (n >>> (32 - s));
  
  const addUnsigned = (a: number, b: number) => {
    const lsw = (a & 0xFFFF) + (b & 0xFFFF);
    const msw = (a >> 16) + (b >> 16) + (lsw >> 16);
    return (msw << 16) | (lsw & 0xFFFF);
  };

  // MD5 메시지 패딩
  const msgLen = utf8Bytes.length;
  const nblk = ((msgLen + 8) >> 6) + 1;
  const blks = new Array(nblk * 16);
  
  for (let i = 0; i < nblk * 16; i++) blks[i] = 0;
  for (let i = 0; i < msgLen; i++) {
    blks[i >> 2] |= utf8Bytes[i] << ((i % 4) * 8);
  }
  blks[msgLen >> 2] |= 0x80 << ((msgLen % 4) * 8);
  blks[nblk * 16 - 2] = msgLen * 8;
  // MD5 초기값
  let a = 0x67452301;
  let b = 0xEFCDAB89;
  let c = 0x98BADCFE;
  let d = 0x10325476;

  // MD5 라운드 함수들
  const cmn = (q: number, a: number, b: number, x: number, s: number, t: number) => 
    addUnsigned(rotateLeft(addUnsigned(addUnsigned(a, q), addUnsigned(x, t)), s), b);
  
  const ff = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) =>
    cmn((b & c) | ((~b) & d), a, b, x, s, t);
  
  const gg = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) =>
    cmn((b & d) | (c & (~d)), a, b, x, s, t);
  
  const hh = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) =>
    cmn(b ^ c ^ d, a, b, x, s, t);
  
  const ii = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) =>
    cmn(c ^ (b | (~d)), a, b, x, s, t);

  // MD5 메인 루프
  for (let i = 0; i < nblk * 16; i += 16) {
    const olda = a, oldb = b, oldc = c, oldd = d;

    // Round 1
    a = ff(a, b, c, d, blks[i], 7, 0xD76AA478);
    d = ff(d, a, b, c, blks[i + 1], 12, 0xE8C7B756);
    c = ff(c, d, a, b, blks[i + 2], 17, 0x242070DB);
    b = ff(b, c, d, a, blks[i + 3], 22, 0xC1BDCEEE);
    a = ff(a, b, c, d, blks[i + 4], 7, 0xF57C0FAF);
    d = ff(d, a, b, c, blks[i + 5], 12, 0x4787C62A);
    c = ff(c, d, a, b, blks[i + 6], 17, 0xA8304613);
    b = ff(b, c, d, a, blks[i + 7], 22, 0xFD469501);
    a = ff(a, b, c, d, blks[i + 8], 7, 0x698098D8);
    d = ff(d, a, b, c, blks[i + 9], 12, 0x8B44F7AF);
    c = ff(c, d, a, b, blks[i + 10], 17, 0xFFFF5BB1);
    b = ff(b, c, d, a, blks[i + 11], 22, 0x895CD7BE);
    a = ff(a, b, c, d, blks[i + 12], 7, 0x6B901122);
    d = ff(d, a, b, c, blks[i + 13], 12, 0xFD987193);
    c = ff(c, d, a, b, blks[i + 14], 17, 0xA679438E);
    b = ff(b, c, d, a, blks[i + 15], 22, 0x49B40821);

    // Round 2
    a = gg(a, b, c, d, blks[i + 1], 5, 0xF61E2562);
    d = gg(d, a, b, c, blks[i + 6], 9, 0xC040B340);
    c = gg(c, d, a, b, blks[i + 11], 14, 0x265E5A51);
    b = gg(b, c, d, a, blks[i], 20, 0xE9B6C7AA);
    a = gg(a, b, c, d, blks[i + 5], 5, 0xD62F105D);
    d = gg(d, a, b, c, blks[i + 10], 9, 0x02441453);
    c = gg(c, d, a, b, blks[i + 15], 14, 0xD8A1E681);
    b = gg(b, c, d, a, blks[i + 4], 20, 0xE7D3FBC8);
    a = gg(a, b, c, d, blks[i + 9], 5, 0x21E1CDE6);
    d = gg(d, a, b, c, blks[i + 14], 9, 0xC33707D6);
    c = gg(c, d, a, b, blks[i + 3], 14, 0xF4D50D87);
    b = gg(b, c, d, a, blks[i + 8], 20, 0x455A14ED);
    a = gg(a, b, c, d, blks[i + 13], 5, 0xA9E3E905);
    d = gg(d, a, b, c, blks[i + 2], 9, 0xFCEFA3F8);
    c = gg(c, d, a, b, blks[i + 7], 14, 0x676F02D9);
    b = gg(b, c, d, a, blks[i + 12], 20, 0x8D2A4C8A);

    // Round 3
    a = hh(a, b, c, d, blks[i + 5], 4, 0xFFFA3942);
    d = hh(d, a, b, c, blks[i + 8], 11, 0x8771F681);
    c = hh(c, d, a, b, blks[i + 11], 16, 0x6D9D6122);
    b = hh(b, c, d, a, blks[i + 14], 23, 0xFDE5380C);
    a = hh(a, b, c, d, blks[i + 1], 4, 0xA4BEEA44);
    d = hh(d, a, b, c, blks[i + 4], 11, 0x4BDECFA9);
    c = hh(c, d, a, b, blks[i + 7], 16, 0xF6BB4B60);
    b = hh(b, c, d, a, blks[i + 10], 23, 0xBEBFBC70);
    a = hh(a, b, c, d, blks[i + 13], 4, 0x289B7EC6);
    d = hh(d, a, b, c, blks[i], 11, 0xEAA127FA);
    c = hh(c, d, a, b, blks[i + 3], 16, 0xD4EF3085);
    b = hh(b, c, d, a, blks[i + 6], 23, 0x04881D05);
    a = hh(a, b, c, d, blks[i + 9], 4, 0xD9D4D039);
    d = hh(d, a, b, c, blks[i + 12], 11, 0xE6DB99E5);
    c = hh(c, d, a, b, blks[i + 15], 16, 0x1FA27CF8);
    b = hh(b, c, d, a, blks[i + 2], 23, 0xC4AC5665);

    // Round 4
    a = ii(a, b, c, d, blks[i], 6, 0xF4292244);
    d = ii(d, a, b, c, blks[i + 7], 10, 0x432AFF97);
    c = ii(c, d, a, b, blks[i + 14], 15, 0xAB9423A7);
    b = ii(b, c, d, a, blks[i + 5], 21, 0xFC93A039);
    a = ii(a, b, c, d, blks[i + 12], 6, 0x655B59C3);
    d = ii(d, a, b, c, blks[i + 3], 10, 0x8F0CCC92);
    c = ii(c, d, a, b, blks[i + 10], 15, 0xFFEFF47D);
    b = ii(b, c, d, a, blks[i + 1], 21, 0x85845DD1);
    a = ii(a, b, c, d, blks[i + 8], 6, 0x6FA87E4F);
    d = ii(d, a, b, c, blks[i + 15], 10, 0xFE2CE6E0);
    c = ii(c, d, a, b, blks[i + 6], 15, 0xA3014314);
    b = ii(b, c, d, a, blks[i + 13], 21, 0x4E0811A1);
    a = ii(a, b, c, d, blks[i + 4], 6, 0xF7537E82);
    d = ii(d, a, b, c, blks[i + 11], 10, 0xBD3AF235);
    c = ii(c, d, a, b, blks[i + 2], 15, 0x2AD7D2BB);
    b = ii(b, c, d, a, blks[i + 9], 21, 0xEB86D391);

    a = addUnsigned(a, olda);
    b = addUnsigned(b, oldb);
    c = addUnsigned(c, oldc);
    d = addUnsigned(d, oldd);
  }

  // 결과를 hex 문자열로 변환
  const toHex = (n: number) => {
    let s = '';
    for (let j = 0; j <= 3; j++) {
      s += ((n >> (j * 8)) & 0xFF).toString(16).padStart(2, '0');
    }
    return s;
  };

  return toHex(a) + toHex(b) + toHex(c) + toHex(d);
}

// Invest API 설정
const INVEST_API_BASE_URL = 'https://api.invest-ho.com';
const PROXY_URL = 'https://vi8282.com/proxy';

// Proxy 서버 상태 체크 함수
export async function checkProxyHealth(): Promise<{ healthy: boolean; message: string; latency?: number }> {
  const startTime = Date.now();
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: `${INVEST_API_BASE_URL}/health`,
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      }),
      signal: controller.signal,
      mode: 'cors',
      credentials: 'omit'
    });
    
    clearTimeout(timeoutId);
    const latency = Date.now() - startTime;
    
    if (response.ok) {
      console.log(`✅ Proxy 서버 정상 (응답시간: ${latency}ms)`);
      return {
        healthy: true,
        message: `Proxy 서버 정상 (응답시간: ${latency}ms)`,
        latency
      };
    } else {
      return {
        healthy: false,
        message: `Proxy 서버 오류 (HTTP ${response.status})`
      };
    }
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return {
          healthy: false,
          message: 'Proxy 서버 타임아웃 (5초 이상 무응답)'
        };
      }
      
      if (error.message.includes('Failed to fetch') || error.message.includes('fetch')) {
        return {
          healthy: false,
          message: `Proxy 서버(${PROXY_URL})에 연결할 수 없습니다. 네트워크 또는 CORS 설정을 확인하세요.`
        };
      }
    }
    
    return {
      healthy: false,
      message: `Proxy 서버 오류: ${error instanceof Error ? error.message : '알 수 없는 오류'}`
    };
  }
}

// ❌ 하드코딩 제거 완료
// 모든 API 호출은 opcodeHelper.getAdminOpcode()로 조회한 값을 사용합니다.

// Signature 생성 함수 (UTF-8 인코딩 후 MD5)
export function generateSignature(params: string[], secretKey: string): string {
  const combined = params.join('') + secretKey;
  const signature = md5Hash(combined);
  
  // 디버깅: Signature 생성 로그
  console.log('🔐 Signature 생성:', {
    params: params,
    secretKey: '***' + secretKey.slice(-4),
    combined_string_preview: combined.substring(0, 100) + (combined.length > 100 ? '...' : ''),
    combined_length: combined.length,
    signature: signature,
    // Guidelines 확인용
    validation: `md5(${params.join(' + ')} + secretKey)`,
    exact_formula: `md5("${params.join('" + "')}" + "***${secretKey.slice(-4)}")`
  });
  
  return signature;
}

// Proxy를 통한 API 호출 (재시도 로직 포함)
export async function callInvestApi(
  endpoint: string,
  method: string = 'GET',
  body?: any,
  retries: number = 2
): Promise<{ data: any | null; error: string | null; status?: number }> {
  let lastError: any = null;
  
  // 재시도 로직
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      console.log(`🔄 재시도 ${attempt}/${retries}...`);
      // 재시도 전 잠시 대기 (지수 백오프)
      await new Promise(resolve => setTimeout(resolve, Math.min(1000 * Math.pow(2, attempt - 1), 5000)));
    }
    
    try {
      const url = `${INVEST_API_BASE_URL}${endpoint}`;
      const proxyPayload = {
        url,
        method,
        headers: {
          'Content-Type': 'application/json'
        },
        body
      };
      
      if (attempt === 0) {
        console.log('🌐 Proxy 서버 호출:', {
          proxy_url: PROXY_URL,
          target_url: url,
          method: method,
          opcode: body?.opcode || 'N/A'
        });
      }
      
      // Timeout 설정 (30초)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      
      const response = await fetch(PROXY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/plain, */*'
        },
        body: JSON.stringify(proxyPayload),
        signal: controller.signal,
        mode: 'cors',
        credentials: 'omit'
      });

      clearTimeout(timeoutId);

      console.log('📡 Proxy 응답 상태:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        contentType: response.headers.get('content-type')
      });

      if (!response.ok) {
        let errorText = '';
        try {
          errorText = await response.text();
        } catch (e) {
          errorText = `응답 읽기 실패 (${response.status})`;
        }
        console.error('❌ Proxy 서버 오류:', errorText);
        
        // 5xx 오류는 재시도, 4xx 오류는 즉시 반환
        if (response.status >= 500 && attempt < retries) {
          lastError = new Error(`서버 오류 (${response.status}): ${errorText}`);
          continue;
        }
        
        return {
          data: null,
          error: `API 호출 실패 (${response.status}): ${errorText}`,
          status: response.status
        };
      }

      // 응답 데이터 파싱
      let result: any;
      const responseText = await response.text();
      
      if (attempt === 0) {
        console.log('📄 Raw 응답:', responseText.substring(0, 500) + (responseText.length > 500 ? '...' : ''));
      }
      
      if (!responseText.trim()) {
        console.warn('⚠️ 빈 응답 수신');
        if (attempt < retries) {
          lastError = new Error('빈 응답을 받았습니다');
          continue;
        }
        return {
          data: null,
          error: '빈 응답을 받았습니다',
          status: response.status
        };
      }

      // 🔧 안전한 JSON 파싱
      try {
        result = JSON.parse(responseText);
        
        // 파싱된 결과 안전성 검증
        if (result && typeof result === 'object') {
          // DATA 필드가 있다면 타입 검증
          if (result.DATA !== undefined && result.DATA !== null) {
            if (!Array.isArray(result.DATA) && typeof result.DATA !== 'object') {
              console.warn('⚠️ DATA 필드가 예상하지 못한 타입:', typeof result.DATA);
              // DATA를 안전한 형태로 변환
              result.DATA = [];
            }
          }
        } else {
          console.warn('⚠️ 파싱된 결과가 객체가 아님:', typeof result);
          result = { data: result, is_fallback: true };
        }
        
      } catch (jsonError) {
        // JSON이 아닌 경우 텍스트로 처리
        console.log('📝 JSON 파싱 실패, 텍스트로 처리:', responseText);
        result = {
          text_response: responseText,
          is_text: true
        };
      }
      
      console.log('✅ Proxy 응답 파싱 완료:', {
        type: typeof result,
        isArray: Array.isArray(result),
        keys: typeof result === 'object' ? Object.keys(result) : null
      });
      
      return {
        data: result,
        error: null,
        status: response.status
      };
      
    } catch (error) {
      lastError = error;
      
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          console.error('❌ API 호출 타임아웃');
          if (attempt < retries) {
            continue;
          }
          return {
            data: null,
            error: 'API 호출 타임아웃 (30초). Proxy 서버가 응답하지 않습니다.',
            status: 408
          };
        }
        
        // TypeError: Failed to fetch - 네트워크 오류
        if (error.message.includes('Failed to fetch') || error.message.includes('fetch')) {
          console.error('❌ 네트워크 오류:', error.message);
          if (attempt < retries) {
            continue;
          }
          return {
            data: null,
            error: `Proxy 서버(${PROXY_URL})에 연결할 수 없습니다. 네트워크 연결을 확인하세요.`,
            status: 0
          };
        }
      }
      
      console.error('❌ Invest API 호출 오류:', error);
      if (attempt < retries) {
        continue;
      }
    }
  }
  
  // 모든 재시도 실패
  const errorMessage = lastError instanceof Error ? lastError.message : '알 수 없는 오류';
  console.error('❌ 모든 재시도 실패:', errorMessage);
  
  return {
    data: null,
    error: `API 호출 실패 (재시도 ${retries}회): ${errorMessage}`,
    status: 500
  };
}

// 계정 생성 및 로그인
export async function createAccount(opcode: string, username: string, secretKey: string) {
  const signature = generateSignature([opcode, username], secretKey);
  
  return await callInvestApi('/api/account', 'POST', {
    opcode,
    username,
    signature
  });
}

// 개별 계정 잔고 조회
// token: 대본사 생성시 입력된 token 값 사용
export async function getAccountBalance(opcode: string, username: string, token: string, secretKey: string) {
  const signature = generateSignature([opcode, username, token], secretKey);
  
  return await callInvestApi('/api/account/balance', 'GET', {
    opcode,
    username,
    token,
    signature
  });
}

// 전체 계정 잔고 조회
export async function getAllAccountBalances(opcode: string, secretKey: string) {
  const signature = generateSignature([opcode], secretKey);
  
  return await callInvestApi('/api/account/balance', 'PATCH', {
    opcode,
    signature
  });
}

// 계정 입금
// token: 대본사의 영구 token 값 사용
export async function depositToAccount(opcode: string, username: string, token: string, amount: number, secretKey: string) {
  // amount를 정수로 변환 (Guidelines: 입금액(숫자만))
  const amountInt = Math.floor(amount);
  const signature = generateSignature([opcode, username, token, amountInt.toString()], secretKey);
  
  console.log('💰 입금 API 호출 준비:', {
    opcode,
    username,
    token: '***' + token.slice(-4),
    amount: amountInt,
    signature_params: [opcode, username, token, amountInt.toString()].join(' + '),
    signature
  });
  
  return await callInvestApi('/api/account/balance', 'POST', {
    opcode,
    username,
    token,
    amount: amountInt,
    signature
  });
}

// 계정 출금
// token: 대본사의 영구 token 값 사용
export async function withdrawFromAccount(opcode: string, username: string, token: string, amount: number, secretKey: string) {
  // amount를 정수로 변환 (Guidelines: 출금액(숫자만))
  const amountInt = Math.floor(amount);
  const signature = generateSignature([opcode, username, token, amountInt.toString()], secretKey);
  
  console.log('💸 출금 API 호출 준비:', {
    opcode,
    username,
    token: '***' + token.slice(-4),
    amount: amountInt,
    signature_params: [opcode, username, token, amountInt.toString()].join(' + '),
    signature
  });
  
  return await callInvestApi('/api/account/balance', 'PUT', {
    opcode,
    username,
    token,
    amount: amountInt,
    signature
  });
}

// 입금 함수 - opcode, token, secretKey 필수 (하드코딩 금지)
export async function depositBalance(username: string, amount: number, opcode: string, token: string, secretKey: string) {
  if (!opcode || !token || !secretKey) {
    console.error('❌ depositBalance: opcode, token, secretKey 필수 파라미터 누락');
    return {
      success: false,
      error: 'opcode, token, secretKey는 필수입니다. opcodeHelper.getAdminOpcode()로 조회하세요.',
      data: null
    };
  }
  
  const result = await depositToAccount(
    opcode,
    username,
    token,
    amount,
    secretKey
  );
  
  return {
    success: !result.error,
    error: result.error,
    data: result.data
  };
}

// 출금 함수 - opcode, token, secretKey 필수 (하드코딩 금지)
export async function withdrawBalance(username: string, amount: number, opcode: string, token: string, secretKey: string) {
  if (!opcode || !token || !secretKey) {
    console.error('❌ withdrawBalance: opcode, token, secretKey 필수 파라미터 누락');
    return {
      success: false,
      error: 'opcode, token, secretKey는 필수입니다. opcodeHelper.getAdminOpcode()로 조회하세요.',
      data: null
    };
  }
  
  const result = await withdrawFromAccount(
    opcode,
    username,
    token,
    amount,
    secretKey
  );
  
  return {
    success: !result.error,
    error: result.error,
    data: result.data
  };
}

// 사용자 입출금 기록 조회
export async function getAccountHistory(opcode: string, username: string, dateFrom: string, dateTo: string, secretKey: string) {
  const signature = generateSignature([opcode, username, dateFrom, dateTo], secretKey);
  
  return await callInvestApi('/api/account/balance', 'VIEW', {
    opcode,
    username,
    date_from: dateFrom,
    date_to: dateTo,
    signature
  });
}

// 기본정보 조회
export async function getInfo(opcode: string, secretKey: string) {
  const signature = generateSignature([opcode], secretKey);
  
  console.log('📊 기본정보 조회 API 호출:', {
    opcode,
    secretKey: '***' + secretKey.slice(-4),
    signature
  });
  
  return await callInvestApi('/api/info', 'GET', {
    opcode,
    signature
  });
}

// 이미지 URL 추출 함수
// API 응답은 주로 game_image 필드로 제공됨
function extractImageUrl(game: any): string | null {
  // game_image가 주요 필드 (API 응답 기준)
  if (game.game_image && typeof game.game_image === 'string' && game.game_image.trim()) {
    const url = game.game_image.trim();
    if (url.startsWith('http') || url.startsWith('//')) {
      return url;
    }
  }
  
  // fallback: 다른 가능한 필드명들
  const fallbackFields = ['image_url', 'imageUrl', 'img_url', 'thumbnail'];
  for (const field of fallbackFields) {
    const value = game[field];
    if (value && typeof value === 'string' && value.trim()) {
      const url = value.trim();
      if (url.startsWith('http') || url.startsWith('//')) {
        return url;
      }
    }
  }

  return null;
}

// 게임 목록 조회
export async function getGameList(opcode: string, providerId: number, secretKey: string) {
  const signature = generateSignature([opcode, providerId.toString()], secretKey);
  
  console.log(`📡 게임 리스트 API 호출 시작 - Provider ID: ${providerId}`);
  
  const result = await callInvestApi('/api/game/lists', 'GET', {
    opcode,
    provider_id: providerId,
    signature
  });
  
  // API 응답 정규화 및 로깅
  if (result.data && !result.error && Array.isArray(result.data?.DATA)) {
    const firstGame = result.data.DATA[0];
    console.log(`📊 Provider ${providerId} API 응답:`, {
      총게임수: result.data.DATA.length,
      샘플게임: firstGame ? {
        전체필드: Object.keys(firstGame),
        game_image: firstGame.game_image,
        game_title: firstGame.game_title || firstGame.name
      } : null
    });

    // 이미지 URL 정규화: game_image -> image_url
    result.data.DATA = result.data.DATA.map(game => {
      const imageUrl = extractImageUrl(game);
      return {
        ...game,
        image_url: imageUrl || game.image_url || null
      };
    });

    // 정규화 결과 확인
    const withImage = result.data.DATA.filter(g => g.image_url).length;
    const withoutImage = result.data.DATA.length - withImage;
    console.log(`✅ Provider ${providerId} 이미지 정규화:`, {
      총게임: result.data.DATA.length,
      이미지있음: withImage,
      이미지없음: withoutImage
    });
  }
  
  return result;
}

// 게임 실행 (개선된 로깅 및 오류 처리)
export async function launchGame(opcode: string, username: string, token: string, gameId: number, secretKey: string) {
  console.log('🎮 게임 실행 API 호출:', {
    opcode,
    username,
    gameId,
    endpoint: '/api/game/launch'
  });

  const signature = generateSignature([opcode, username, token, gameId.toString()], secretKey);
  
  const response = await callInvestApi('/api/game/launch', 'POST', {
    opcode,
    username,
    token,
    game: gameId,
    signature
  });

  console.log('🎮 게임 실행 API 응답:', {
    success: !response.error,
    data: response.data,
    error: response.error
  });

  // 에러가 있으면 실패 응답
  if (response.error) {
    return {
      success: false,
      error: response.error,
      data: null
    };
  }

  // 성공 응답 처리 - 게임 URL 찾기
  let gameUrl = '';
  const responseData = response.data;
  
  if (responseData) {
    // 텍스트 응답인 경우
    if (responseData.is_text && responseData.text_response) {
      const urlMatch = responseData.text_response.match(/https?:\/\/[^\s<>"]+/);
      gameUrl = urlMatch ? urlMatch[0] : '';
    }
    // JSON 응답인 경우
    else if (!responseData.is_text) {
      gameUrl = responseData.game_url || 
                responseData.url || 
                responseData.launch_url ||
                responseData.gameUrl ||
                responseData.DATA?.game_url ||
                responseData.DATA?.url ||
                '';
    }
    // 문자열 응답인 경우
    else if (typeof responseData === 'string') {
      const urlMatch = responseData.match(/https?:\/\/[^\s<>"]+/);
      gameUrl = urlMatch ? urlMatch[0] : '';
    }
  }

  if (!gameUrl) {
    // 게임 URL을 찾지 못한 경우
    let errorMessage = '게임 실행 URL을 받지 못했습니다.';
    
    if (responseData && !responseData.is_text && typeof responseData === 'object') {
      if (responseData.RESULT === false) {
        errorMessage = responseData.DATA?.message || responseData.message || errorMessage;
      }
      if (responseData.code === 0 && responseData.message) {
        errorMessage = responseData.message;
      }
    }

    return {
      success: false,
      error: errorMessage,
      data: responseData
    };
  }

  // 성공 응답
  return {
    success: true,
    error: null,
    data: {
      game_url: gameUrl,
      url: gameUrl,
      launch_url: gameUrl
    }
  };
}

// 게임 기록 조회 (인덱스 방식)
export async function getGameHistory(opcode: string, year: string, month: string, index: number, limit: number = 1000, secretKey: string) {
  // Guidelines: md5(opcode + year + month + index + secret_key)
  const signature = generateSignature([opcode, year, month, index.toString()], secretKey);
  
  console.log('📊 getGameHistory 호출:', {
    opcode,
    year,
    month,
    index,
    limit,
    signature_formula: `md5(${opcode} + ${year} + ${month} + ${index} + ***${secretKey.slice(-4)})`,
    signature
  });
  
  return await callInvestApi('/api/game/historyindex', 'GET', {
    opcode,
    year,
    month,
    index,
    limit,
    signature
  });
}

// 라운드 상세 정보
export async function getGameDetail(opcode: string, yyyymm: string, txid: number, secretKey: string) {
  const signature = generateSignature([opcode, yyyymm, txid.toString()], secretKey);
  
  return await callInvestApi('/api/game/detail', 'GET', {
    opcode,
    yyyymm,
    txid,
    signature
  });
}

// 게임 공급사 목록
export const GAME_PROVIDERS = {
  SLOT: {
    1: '마이크로게이밍',
    17: '플레이앤고',
    20: 'CQ9 게이밍',
    21: '제네시스 게이밍',
    22: '하바네로',
    23: '게임아트',
    27: '플레이텍',
    38: '블루프린트',
    39: '부운고',
    40: '드라군소프트',
    41: '엘크 스튜디오',
    47: '드림테크',
    51: '칼람바 게임즈',
    52: '모빌롯',
    53: '노리밋 시티',
    55: 'OMI 게이밍',
    56: '원터치',
    59: '플레이슨',
    60: '푸쉬 게이밍',
    61: '퀵스핀',
    62: 'RTG 슬롯',
    63: '리볼버 게이밍',
    65: '슬롯밀',
    66: '스피어헤드',
    70: '썬더킥',
    72: '우후 게임즈',
    74: '릴렉스 게이밍',
    75: '넷엔트',
    76: '레드타이거',
    87: 'PG소프트',
    88: '플레이스타',
    90: '빅타임게이밍',
    300: '프라그마틱 플레이'
  },
  CASINO: {
    410000: '에볼루션 게이밍',
    77060: '마이크로 게이밍',
    2029: 'Vivo 게이밍',
    30000: '아시아 게이밍',
    78001: '프라그마틱플레이',
    86001: '섹시게이밍',
    11000: '비비아이엔',
    28000: '드림게임',
    89000: '오리엔탈게임',
    91000: '보타',
    44006: '이주기',
    85036: '플레이텍 라이브',
    0: '제네럴 카지노'
  }
};

// Provider ID를 Game ID로부터 계산
export function getProviderIdFromGameId(gameId: number): number {
  return Math.floor(gameId / 1000);
}

// 게임사 이름 조회
export function getProviderName(providerId: number, isSlot: boolean = true): string {
  const providers = isSlot ? GAME_PROVIDERS.SLOT : GAME_PROVIDERS.CASINO;
  return providers[providerId as keyof typeof providers] || `Unknown Provider (${providerId})`;
}

// API 응답 검증 함수
export function validateApiResponse(response: any): { isValid: boolean; error?: string; isNoData?: boolean } {
  if (!response) {
    return { isValid: false, error: 'API 응답이 없습니다' };
  }

  // 텍스트 응답인 경우 URL이 포함되어 있으면 성공으로 간주
  if (response.is_text && response.text_response) {
    const hasUrl = response.text_response.includes('http');
    const hasError = response.text_response.toLowerCase().includes('error');
    
    if (hasUrl && !hasError) {
      return { isValid: true };
    }
    
    if (hasError) {
      return { 
        isValid: false, 
        error: `API 오류: ${response.text_response.substring(0, 200)}` 
      };
    }
    
    // 잔고 업데이트나 계정 처리 응답의 경우 숫자가 포함되어 있으면 성공
    const hasBalance = /balance|amount|success/i.test(response.text_response);
    if (hasBalance) {
      return { isValid: true };
    }
  }

  // JSON 응답 처리
  if (!response.is_text) {
    // RESULT가 false인 경우 처리
    if (response.RESULT === false) {
      const errorMessage = response.DATA?.message || response.message || '처리에 실패했습니다';
      
      // "기록이 존재하지 않습니다" 같은 메시지는 에러가 아닌 정상 응답으로 처리
      if (errorMessage.includes('게임기록이 존재하지 않습니다') ||
          errorMessage.includes('기록이 존재하지 않습니다') ||
          errorMessage.includes('no data') ||
          response.code === 400) {
        return { 
          isValid: true, 
          isNoData: true,
          error: errorMessage 
        };
      }
      
      return { 
        isValid: false, 
        error: errorMessage 
      };
    }

    // 공통 오류 메시지 처리
    if (response.error_code || response.ERROR) {
      const errorCode = response.error_code || response.ERROR;
      const errorMessages: Record<string, string> = {
        '1001': 'OPCODE가 유효하지 않습니다',
        '1002': '서명(Signature)이 올바르지 않습니다',
        '1003': '사용자를 찾을 수 없습니다',
        '1004': '잔고가 부족합니다',
        '1005': '게임을 찾을 수 없습니다',
        '1006': '제공사를 찾을 수 없습니다',
        '2001': 'API 서버 내부 오류',
        '2002': '데이터베이스 연결 오류',
        '3001': '요청 파라미터 오류'
      };
      
      return { 
        isValid: false, 
        error: errorMessages[errorCode] || `API 오류 (${errorCode}): ${response.message || '알 수 없는 오류'}` 
      };
    }

    // 성공 응답 확인
    if (response.RESULT === true || response.success === true || response.DATA) {
      return { isValid: true };
    }
  }

  // 기본적으로 성공으로 간주 (응답이 있으면)
  return { isValid: true };
}

// 잔고 데이터 안전 추출 함수
export function extractBalanceFromResponse(response: any, username?: string): number {
  if (!response) return 0;

  console.log('💰 잔고 추출 시도:', { response: typeof response, username });

  // 텍스트 응답에서 잔고 추출
  if (response.is_text && response.text_response) {
    const text = response.text_response;
    
    // 숫자 패턴 찾기
    const numberMatches = text.match(/\d+(?:\.\d+)?/g);
    if (numberMatches && numberMatches.length > 0) {
      // 가장 큰 숫자를 잔고로 가정 (일반적으로 잔고가 가장 큰 수)
      const numbers = numberMatches.map(n => parseFloat(n));
      const balance = Math.max(...numbers);
      console.log('📊 텍스트에서 추출된 잔고:', balance);
      return balance;
    }
  }

  // JSON 응답 처리
  if (!response.is_text) {
    // 🔧 안전한 응답 검증
    if (!response || typeof response !== 'object') {
      console.warn('⚠️ 유효하지 않은 JSON 응답:', response);
      return 0;
    }

    try {
      // 직접 잔고 값이 있는 경우
      if (typeof response.balance === 'number') {
        return response.balance;
      }
      if (typeof response.amount === 'number') {
        return response.amount;
      }
      if (typeof response.current_balance === 'number') {
        return response.current_balance;
      }
    } catch (error) {
      console.error('❌ JSON 잔고 파싱 오류:', error);
      return 0;
    }

    // DATA 내부에 있는 경우  
    if (response.DATA) {
      try {
      // 배열인 경우
      if (Array.isArray(response.DATA)) {
        if (username) {
          try {
            const userBalance = response.DATA.find((user: any) => user?.username === username);
            return userBalance?.balance || userBalance?.amount || userBalance?.current_balance || 0;
          } catch (findError) {
            console.warn('⚠️ 배열 검색 중 오류:', findError);
            return 0;
          }
        }
        return response.DATA[0]?.balance || response.DATA[0]?.amount || response.DATA[0]?.current_balance || 0;
      }
      
      // 객체인 경우
      if (typeof response.DATA === 'object') {
        // 직접 잔고 정보가 있는 경우
        if (typeof response.DATA.balance === 'number') {
          return response.DATA.balance;
        }
        if (typeof response.DATA.amount === 'number') {
          return response.DATA.amount;
        }
        if (typeof response.DATA.current_balance === 'number') {
          return response.DATA.current_balance;
        }
        
        // users 배열이 있는 경우
        if (Array.isArray(response.DATA.users) && username) {
          try {
            const userBalance = response.DATA.users.find((user: any) => user?.username === username);
            return userBalance?.balance || userBalance?.amount || userBalance?.current_balance || 0;
          } catch (findError) {
            console.warn('⚠️ users 배열 검색 중 오류:', findError);
            return 0;
          }
        }
      }
      } catch (dataError) {
        console.error('❌ DATA 블록 파싱 오류:', dataError);
        return 0;
      }
    }

    // 직접 배열인 경우
    if (Array.isArray(response) && username) {
      try {
        const userBalance = response.find((user: any) => user?.username === username);
        return userBalance?.balance || userBalance?.amount || userBalance?.current_balance || 0;
      } catch (findError) {
        console.warn('⚠️ 직접 배열 검색 중 오류:', findError);
        return 0;
      }
    }
  }

  console.log('⚠️ 잔고를 찾을 수 없음, 0 반환');
  return 0;
}

// 사용자 보유금 조회 (GET /api/account/balance)
export async function getUserBalance(opcode: string, username: string, token: string, secretKey: string) {
  const signature = generateSignature([opcode, username, token], secretKey);
  
  return await callInvestApi('/api/account/balance', 'GET', {
    opcode,
    username,
    token,
    signature
  });
}

// 재시도 로직이 포함된 API 호출 함수
export async function callInvestApiWithRetry(
  endpoint: string,
  method: string = 'GET',
  body?: any,
  maxRetries = 3,
  retryDelay = 1000
): Promise<{ data: any | null; error: string | null; status?: number }> {
  let lastError: string | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await callInvestApi(endpoint, method, body);
      
      // 응답 검증
      const validation = validateApiResponse(result.data);
      if (!validation.isValid) {
        return {
          data: null,
          error: validation.error!,
          status: result.status
        };
      }
      
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error.message : '알 수 없는 오류';
      
      if (attempt < maxRetries) {
        console.warn(`API 호출 실패 (시도 ${attempt}/${maxRetries}), ${retryDelay}ms 후 재시도:`, lastError);
        await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
      }
    }
  }
  
  return {
    data: null,
    error: `API 호출 실패 (${maxRetries}회 시도 후): ${lastError}`,
    status: 500
  };
}

// 대량 API 호출을 위한 배치 처리 함수
export async function batchApiCalls<T>(
  calls: (() => Promise<T>)[],
  batchSize = 5,
  delayBetweenBatches = 1000
): Promise<T[]> {
  const results: T[] = [];
  
  for (let i = 0; i < calls.length; i += batchSize) {
    const batch = calls.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map(call => call())
    );
    
    batchResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        console.error(`배치 API 호출 실패 (인덱스 ${i + index}):`, result.reason);
        // 실패한 경우에도 결과 배열에 null을 추가하여 인덱스 매칭 유지
        results.push(null as T);
      }
    });
    
    // 배치 간 지연
    if (i + batchSize < calls.length) {
      await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
    }
  }
  
  return results;
}

// OPCODE별 API 설정 캐시
const opcodeConfigCache = new Map<string, { opcode: string; secretKey: string; token: string }>();

// OPCODE 설정 캐시 관리
export function cacheOpcodeConfig(opcode: string, secretKey: string, token: string) {
  opcodeConfigCache.set(opcode, { opcode, secretKey, token });
}

export function getCachedOpcodeConfig(opcode: string) {
  return opcodeConfigCache.get(opcode);
}

export function clearOpcodeConfigCache() {
  opcodeConfigCache.clear();
}

// investApi 객체로 내보내기 (컴포넌트에서 investApi.function() 형태로 사용 가능)
export const investApi = {
  createAccount,
  getAccountBalance,
  getAllAccountBalances,
  depositToAccount,
  withdrawFromAccount,
  getAccountHistory,
  getInfo,
  getGameList,
  launchGame,
  getGameHistory,
  getGameDetail,
  generateSignature,
  createSignature: generateSignature, // 별칭 추가
  callInvestApi,
  callInvestApiWithRetry,
  validateApiResponse,
  extractBalanceFromResponse,
  batchApiCalls,
  cacheOpcodeConfig,
  getCachedOpcodeConfig,
  clearOpcodeConfigCache,
  getProviderIdFromGameId,
  getProviderName,
  GAME_PROVIDERS
};