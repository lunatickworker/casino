import { supabase } from './supabase';
import { investApi, generateSignature } from './investApi';

// 게임 제공사 조회
async function getProviders(): Promise<any[]> {
  const { data, error } = await supabase
    .from('game_providers')
    .select('*')
    .eq('status', 'active')
    .order('type', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    console.error('제공사 조회 오류:', error);
    throw error;
  }

  console.log(`🎮 제공사 조회 결과: ${data?.length || 0}개`);
  
  // 타입별 개수 로그
  const slotCount = data?.filter(p => p.type === 'slot').length || 0;
  const casinoCount = data?.filter(p => p.type === 'casino').length || 0;
  console.log(`  📊 슬롯: ${slotCount}개, 카지노: ${casinoCount}개`);

  // 제공사가 부족한 경우 자동으로 초기화
  if (slotCount < 30 || casinoCount < 10) {
    console.log('⚠️ 제공사 데이터가 부족합니다. 자동 초기화를 시도합니다...');
    await initializeGameProviders();
    
    // 다시 조회
    const { data: retryData, error: retryError } = await supabase
      .from('game_providers')
      .select('*')
      .eq('status', 'active')
      .order('type', { ascending: true })
      .order('name', { ascending: true });

    if (!retryError && retryData) {
      const retrySlotCount = retryData.filter(p => p.type === 'slot').length;
      const retryCasinoCount = retryData.filter(p => p.type === 'casino').length;
      console.log(`✅ 재조회 결과 - 슬롯: ${retrySlotCount}개, 카지노: ${retryCasinoCount}개`);
      return retryData;
    }
  }

  return data || [];
}

// 게임 목록 조회 (파트너별 설정 포함)
async function getGames(partnerIdOrFilters?: string | {
  provider_id?: number;
  search?: string;
  status?: string;
  type?: string;
}, additionalFilters?: {
  provider_id?: number;
  search?: string;
  status?: string;
  type?: string;
}): Promise<any[]> {
  let partnerId: string | undefined;
  let filters: any;

  // 첫 번째 인자가 문자열이면 partnerId, 아니면 filters
  if (typeof partnerIdOrFilters === 'string') {
    partnerId = partnerIdOrFilters;
    filters = additionalFilters || {};
  } else {
    filters = partnerIdOrFilters || {};
  }

  console.log('🔍 getGames 호출:', { partnerId, filters });

  // partnerId가 있으면 game_status_logs와 조인하여 파트너별 상태 조회
  let query;
  
  if (partnerId) {
    query = supabase
      .from('games')
      .select(`
        id,
        provider_id,
        name,
        type,
        status,
        image_url,
        demo_available,
        is_featured,
        priority,
        rtp,
        play_count,
        created_at,
        updated_at,
        game_providers!inner(
          id,
          name,
          type
        ),
        game_status_logs!left(
          status,
          priority,
          is_featured
        )
      `);
    
    // game_status_logs의 partner_id 필터
    query = query.or(`partner_id.eq.${partnerId},partner_id.is.null`, { foreignTable: 'game_status_logs' });
  } else {
    // partnerId 없으면 기본 조회
    query = supabase
      .from('games')
      .select(`
        id,
        provider_id,
        name,
        type,
        status,
        image_url,
        demo_available,
        is_featured,
        priority,
        rtp,
        play_count,
        created_at,
        updated_at,
        game_providers!inner(
          id,
          name,
          type
        )
      `);
  }

  // 타입 필터 먼저 적용 (중요: 카지노/슬롯 분리)
  if (filters?.type) {
    query = query.eq('type', filters.type);
    console.log('🔍 타입 필터 적용:', filters.type);
  }

  // 나머지 필터 적용
  if (filters?.provider_id) {
    query = query.eq('provider_id', filters.provider_id);
    console.log('🔍 제공사 필터 적용:', filters.provider_id);
  }

  if (filters?.search) {
    query = query.ilike('name', `%${filters.search}%`);
    console.log('🔍 검색 필터 적용:', filters.search);
  }

  if (filters?.status) {
    query = query.eq('status', filters.status);
    console.log('🔍 상태 필터 적용:', filters.status);
  }

  // 정렬: priority 높은 순 (신규 게임 상위 노출) → 카지노는 provider_id 순, 슬롯은 name 순
  if (filters?.type === 'casino') {
    query = query.order('priority', { ascending: false }).order('provider_id');
  } else {
    query = query.order('priority', { ascending: false }).order('name');
  }

  const { data, error } = await query;

  if (error) {
    console.error('게임 조회 오류:', error);
    throw error;
  }

  console.log(`🔍 DB에서 조회된 ${filters?.type || '전체'} 게임:`, {
    총개수: data?.length || 0,
    필터: {
      type: filters?.type,
      provider_id: filters?.provider_id,
      status: filters?.status,
      search: filters?.search
    },
    샘플: data?.slice(0, 3).map(g => ({
      id: g.id,
      name: g.name,
      provider_id: g.provider_id,
      provider_name: g.game_providers?.name
    }))
  });

  // 결과 매핑 - game_status_logs가 있으면 해당 값 사용
  const mappedData = (data || []).map(game => {
    // game_status_logs가 배열로 올 수 있으므로 첫 번째 요소 사용
    const statusLog = Array.isArray(game.game_status_logs) 
      ? game.game_status_logs[0] 
      : game.game_status_logs;
    
    return {
      id: game.id,
      provider_id: game.provider_id,
      name: game.name,
      type: game.type,
      // game_status_logs에 설정이 있으면 해당 값 사용, 없으면 games 테이블의 기본값 사용
      status: statusLog?.status || game.status,
      image_url: game.image_url,
      demo_available: game.demo_available,
      is_featured: statusLog?.is_featured !== undefined ? statusLog.is_featured : (game.is_featured || false),
      priority: statusLog?.priority !== undefined ? statusLog.priority : (game.priority || 0),
      rtp: game.rtp,
      play_count: game.play_count || 0,
      created_at: game.created_at,
      updated_at: game.updated_at,
      provider_name: game.game_providers?.name || '알 수 없음'
    };
  });

  // 클라이언트 측에서 추가 정렬 (파트너별 priority 반영)
  const sortedData = mappedData.sort((a, b) => {
    // 1. priority 높은 순 (신규 게임 상위)
    if (b.priority !== a.priority) {
      return b.priority - a.priority;
    }
    
    // 2. featured 게임 우선
    if (b.is_featured !== a.is_featured) {
      return b.is_featured ? 1 : -1;
    }
    
    // 3. 카지노는 provider_id 순, 슬롯은 이름 순
    if (filters?.type === 'casino') {
      return a.provider_id - b.provider_id;
    } else {
      return a.name.localeCompare(b.name);
    }
  });

  console.log(`✅ 최종 ${filters?.type || '전체'} 게임:`, {
    개수: sortedData.length,
    제공사별_분포: sortedData.reduce((acc: any, g) => {
      acc[g.provider_name] = (acc[g.provider_name] || 0) + 1;
      return acc;
    }, {}),
    상위_5개_우선순위: sortedData.slice(0, 5).map(g => ({ name: g.name, priority: g.priority }))
  });

  return sortedData;
}

// 게임 상태 업데이트
async function updateGameStatus(gameId: number, status: string): Promise<void> {
  const { error } = await supabase
    .from('games')
    .update({ 
      status,
      updated_at: new Date().toISOString()
    })
    .eq('id', gameId);

  if (error) {
    console.error('게임 상태 업데이트 오류:', error);
    throw error;
  }
}

// 외부 API에서 게임 동기화 (성능 최적화 버전)
async function syncGamesFromAPI(
  providerId: number, 
  apiGames?: any[]
): Promise<{ newGames: number; updatedGames: number; totalGames: number }> {
  
  console.log(`🚀 Provider ${providerId} 동기화 시작`);
  const startTime = Date.now();
  
  // apiGames가 제공되지 않은 경우 API 호출
  let gamesData: any[] = [];
  if (apiGames && apiGames.length > 0) {
    gamesData = apiGames;
    console.log(`📥 제공된 게임 데이터 사용 - 총 ${gamesData.length}개 게임`);
  } else {
    console.log(`📡 Provider ${providerId} API 호출 시작`);
    
    // investApi를 통해 게임 리스트 호출
    const { investApi } = await import('./investApi');
    
    // 시스템 관리자의 설정 정보 조회 (가장 먼저 생성된 시스템 관리자)
    const { data: systemAdminData, error: adminError } = await supabase
      .from('partners')
      .select('opcode, secret_key')
      .eq('level', 1)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    
    if (adminError || !systemAdminData) {
      console.error('❌ 시스템 관리자 정보 조회 실패:', adminError);
      throw new Error('시스템 관리자 정보를 찾을 수 없습니다.');
    }
    
    try {
      const apiResponse = await investApi.getGameList(
        systemAdminData.opcode,
        providerId,
        systemAdminData.secret_key
      );
      
      if (apiResponse.error) {
        console.error(`❌ Provider ${providerId} API 호출 실패:`, apiResponse.error);
        // 게임 리스트가 없는 제공사의 경우 빈 배열로 처리
        if (apiResponse.error.includes('게임 목록이 없습니다') || 
            apiResponse.error.includes('지원하지 않는') ||
            apiResponse.error.includes('잘못된 signature') ||
            apiResponse.error.includes('provider not found') ||
            apiResponse.status === 404 ||
            apiResponse.status === 400) {
          console.log(`⚠️ Provider ${providerId}는 게임 리스트가 없거나 지원하지 않는 제공사입니다.`);
          gamesData = [];
        } else {
          throw new Error(apiResponse.error);
        }
      } else if (apiResponse.data?.RESULT === true && Array.isArray(apiResponse.data?.DATA)) {
        gamesData = apiResponse.data.DATA;
        console.log(`✅ Provider ${providerId} API 응답: ${gamesData.length}개 게임 (이미 image_url 정규화됨)`);
        
      } else if (apiResponse.data?.RESULT === false) {
        const message = apiResponse.data?.message || '알 수 없는 오류';
        console.log(`⚠️ Provider ${providerId} API 응답: 게임 리스트 없음 - ${message}`);
        
        // 일반적인 "게임 없음" 메시지들 처리
        if (message.includes('게임이 없습니다') || 
            message.includes('no games') ||
            message.includes('empty') ||
            message.includes('없음')) {
          gamesData = [];
        } else {
          throw new Error(`API 오류: ${message}`);
        }
      } else {
        console.log(`⚠️ Provider ${providerId} 예상치 못한 응답 형식:`, apiResponse.data);
        gamesData = [];
      }
    } catch (error) {
      console.error(`❌ Provider ${providerId} API 호출 중 오류:`, error);
      // 네트워크 오류나 서버 오류의 경우 빈 배열로 처리하여 안정성 확보
      gamesData = [];
    }
  }
  
  console.log(`📊 동기화할 게임 수: ${gamesData.length}개`);
  
  // 제공사 정보 조회
  const { data: providerData, error: providerError } = await supabase
    .from('game_providers')
    .select('type')
    .eq('id', providerId)
    .maybeSingle();

  if (providerError || !providerData) {
    console.error('제공사 조회 오류:', providerError);
    throw new Error(`제공사(ID: ${providerId}) 정보를 찾을 수 없습니다.`);
  }

  const gameType = providerData.type;

  // 기존 게임 조회 (ID와 priority 조회)
  const { data: existingGames, error: fetchError } = await supabase
    .from('games')
    .select('id, priority')
    .eq('provider_id', providerId);

  if (fetchError) {
    console.error('기존 게임 조회 오류:', fetchError);
    throw fetchError;
  }

  const existingGameIds = new Set(existingGames?.map(game => game.id) || []);
  
  // 현재 최대 priority 계산 (신규 게임을 상위에 배치하기 위함)
  const maxPriority = existingGames && existingGames.length > 0 
    ? Math.max(...existingGames.map(g => g.priority || 0))
    : 0;
  
  console.log(`📊 기존 게임 ${existingGameIds.size}개 확인됨, 최대 우선순위: ${maxPriority}`);

  // API 게임 데이터 병렬 처리 (성능 최적화)
  const processedGames: any[] = [];
  const timestamp = new Date().toISOString();
  
  // 배치 처리로 대량 데이터 효율적으로 처리
  const batchSize = 100;
  for (let i = 0; i < gamesData.length; i += batchSize) {
    const batch = gamesData.slice(i, i + batchSize);
    
    const batchProcessed = batch.map((game, index) => {
      // 게임 ID 추출
      const gameId = parseInt(game.id || game.game_id || game.gameId || game.ID);
      if (!gameId || isNaN(gameId)) {
        return null; // 유효하지 않은 게임은 null로 반환
      }

      // 게임명 추출 - game_title을 최우선으로 사용
      let gameName = '';
      
      if (game.game_title && typeof game.game_title === 'string' && game.game_title.trim()) {
        gameName = game.game_title.trim();
      } else if (game.name && typeof game.name === 'string' && game.name.trim()) {
        gameName = game.name.trim();
      } else if (game.game_name && typeof game.game_name === 'string' && game.game_name.trim()) {
        gameName = game.game_name.trim();
      } else if (game.gameName && typeof game.gameName === 'string' && game.gameName.trim()) {
        gameName = game.gameName.trim();
      } else if (game.title && typeof game.title === 'string' && game.title.trim()) {
        gameName = game.title.trim();
      } else {
        gameName = `Game ${gameId}`;
      }

      // 이미지 URL 추출 (investApi에서 이미 game_image -> image_url로 정규화됨)
      const imageUrl = game.image_url || null;

      // 데모 가능 여부
      const demoAvailable = Boolean(game.demo_available || game.demoAvailable || game.demo);

      return {
        id: gameId,
        provider_id: providerId,
        name: gameName,
        type: gameType,
        status: 'visible',
        image_url: imageUrl ? String(imageUrl) : null,
        demo_available: demoAvailable,
        created_at: timestamp,
        updated_at: timestamp,
        isExisting: existingGameIds.has(gameId)
      };
    }).filter(game => game !== null); // null 값 제거
    
    processedGames.push(...batchProcessed);
  }

  console.log(`✅ 처리된 게임 수: ${processedGames.length}개`);

  // 신규 게임과 기존 게임 분리
  const newGames = processedGames.filter(game => !game.isExisting);
  const existingGamesToUpdate = processedGames.filter(game => game.isExisting);

  console.log(`📈 신규 게임: ${newGames.length}개, 업데이트 대상: ${existingGamesToUpdate.length}개`);

  let newCount = 0;
  let updateCount = 0;

  // 신규 게임 배치 추가 (성능 최적화) - 신규 게임에 높은 priority 부여
  if (newGames.length > 0) {
    // 신규 게임에 순차적으로 높은 priority 부여 (상위 노출)
    const gamesToInsert = newGames.map(({ isExisting, ...game }, index) => ({
      ...game,
      priority: maxPriority + newGames.length - index // 가장 최근 게임이 가장 높은 priority
    }));
    
    console.log(`🆕 신규 게임 우선순위 범위: ${maxPriority + 1} ~ ${maxPriority + newGames.length}`);
    
    // 대량 데이터는 청크 단위로 나누어 처리
    const insertBatchSize = 500; // Supabase 배치 제한 고려
    for (let i = 0; i < gamesToInsert.length; i += insertBatchSize) {
      const chunk = gamesToInsert.slice(i, i + insertBatchSize);
      
      const { error: insertError } = await supabase
        .from('games')
        .insert(chunk);

      if (insertError) {
        console.error(`게임 추가 오류 (청크 ${Math.floor(i / insertBatchSize) + 1}):`, insertError);
        throw insertError;
      }
    }

    newCount = newGames.length;
    console.log(`✅ ${newCount}개 신규 게임 추가 완료 (상위 노출 설정)`);
  }

  // 기존 게임 배치 업데이트 (성능 최적화)
  if (existingGamesToUpdate.length > 0) {
    // 배치 업데이트 방식으로 변경
    const updateBatchSize = 100;
    for (let i = 0; i < existingGamesToUpdate.length; i += updateBatchSize) {
      const chunk = existingGamesToUpdate.slice(i, i + updateBatchSize);
      
      // Promise.all로 병렬 처리
      const updatePromises = chunk.map(async (game) => {
        const { isExisting, ...updateData } = game;
        
        const { error: updateError } = await supabase
          .from('games')
          .update({
            name: updateData.name,
            image_url: updateData.image_url,
            demo_available: updateData.demo_available,
            updated_at: updateData.updated_at
          })
          .eq('id', updateData.id)
          .eq('provider_id', providerId);

        if (updateError) {
          console.error(`게임 ${updateData.id} 업데이트 오류:`, updateError);
          return false;
        }
        return true;
      });
      
      const results = await Promise.all(updatePromises);
      updateCount += results.filter(Boolean).length;
    }
    console.log(`✅ ${updateCount}개 기존 게임 업데이트 완료`);
  }

  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(1);

  const result = {
    newGames: newCount,
    updatedGames: updateCount,
    totalGames: processedGames.length
  };

  console.log(`🎯 Provider ${providerId} 동기화 완료 (${duration}초):`, result);
  return result;
}

// 게임 제공사 데이터 초기화 (Guidelines.md 기준)
async function initializeGameProviders(): Promise<void> {
  console.log('🔧 게임 제공사 데이터 초기화 시작...');

  const providersData = [
    // 슬롯 제공사 (33개)
    { id: 1, name: '마이크로게이밍', type: 'slot' },
    { id: 17, name: '플레이앤고', type: 'slot' },
    { id: 20, name: 'CQ9 게이밍', type: 'slot' },
    { id: 21, name: '제네시스 게이밍', type: 'slot' },
    { id: 22, name: '하바네로', type: 'slot' },
    { id: 23, name: '게임아트', type: 'slot' },
    { id: 27, name: '플레이텍', type: 'slot' },
    { id: 38, name: '블루프린트', type: 'slot' },
    { id: 39, name: '부운고', type: 'slot' },
    { id: 40, name: '드라군소프트', type: 'slot' },
    { id: 41, name: '엘크 스튜디오', type: 'slot' },
    { id: 47, name: '드림테크', type: 'slot' },
    { id: 51, name: '칼람바 게임즈', type: 'slot' },
    { id: 52, name: '모빌롯', type: 'slot' },
    { id: 53, name: '노리밋 시티', type: 'slot' },
    { id: 55, name: 'OMI 게이밍', type: 'slot' },
    { id: 56, name: '원터치', type: 'slot' },
    { id: 59, name: '플레이슨', type: 'slot' },
    { id: 60, name: '푸쉬 게이밍', type: 'slot' },
    { id: 61, name: '퀵스핀', type: 'slot' },
    { id: 62, name: 'RTG 슬롯', type: 'slot' },
    { id: 63, name: '리볼버 게이밍', type: 'slot' },
    { id: 65, name: '슬롯밀', type: 'slot' },
    { id: 66, name: '스피어헤드', type: 'slot' },
    { id: 70, name: '썬더킥', type: 'slot' },
    { id: 72, name: '우후 게임즈', type: 'slot' },
    { id: 74, name: '릴렉스 게이밍', type: 'slot' },
    { id: 75, name: '넷엔트', type: 'slot' },
    { id: 76, name: '레드타이거', type: 'slot' },
    { id: 87, name: 'PG소프트', type: 'slot' },
    { id: 88, name: '플레이스타', type: 'slot' },
    { id: 90, name: '빅타임게이밍', type: 'slot' },
    { id: 300, name: '프라그마틱 플레이', type: 'slot' },

    // 카지노 제공사 (13개)
    { id: 410, name: '에볼루션 게이밍', type: 'casino' },
    { id: 77, name: '마이크로 게이밍', type: 'casino' },
    { id: 2, name: 'Vivo 게이밍', type: 'casino' },
    { id: 30, name: '아시아 게이밍', type: 'casino' },
    { id: 78, name: '프라그마틱플레이', type: 'casino' },
    { id: 86, name: '섹시게이밍', type: 'casino' },
    { id: 11, name: '비비아이엔', type: 'casino' },
    { id: 28, name: '드림게임', type: 'casino' },
    { id: 89, name: '오리엔탈게임', type: 'casino' },
    { id: 91, name: '보타', type: 'casino' },
    { id: 44, name: '이주기', type: 'casino' },
    { id: 85, name: '플레이텍 라이브', type: 'casino' },
    { id: 0, name: '제네럴 카지노', type: 'casino' }
  ];

  const providersToInsert = providersData.map(provider => ({
    id: provider.id,
    name: provider.name,
    type: provider.type,
    status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }));

  // 배치 단위로 upsert
  const batchSize = 20;
  let insertedCount = 0;

  for (let i = 0; i < providersToInsert.length; i += batchSize) {
    const batch = providersToInsert.slice(i, i + batchSize);
    
    const { error } = await supabase
      .from('game_providers')
      .upsert(batch, { 
        onConflict: 'id', 
        ignoreDuplicates: false 
      });

    if (error) {
      console.error(`제공사 배치 ${Math.floor(i / batchSize) + 1} 삽입 오류:`, error);
    } else {
      insertedCount += batch.length;
    }
  }

  console.log(`✅ 제공사 데이터 초기화 완료: ${insertedCount}개 처리`);
}

// 카지노 로비 게임 초기화 (필요시 자동 생성)
async function initializeCasinoLobbyGames(): Promise<void> {
  console.log('🎰 카지노 로비 게임 초기화 시작');

  // 카지노 제공사 조회
  const { data: casinoProviders, error: providersError } = await supabase
    .from('game_providers')
    .select('id, name')
    .eq('type', 'casino');

  if (providersError) {
    console.error('카지노 제공사 조회 오류:', providersError);
    return;
  }

  if (!casinoProviders || casinoProviders.length === 0) {
    console.log('카지노 제공사가 없습니다.');
    return;
  }

  // 카지노 로비 게임 매핑 (Guidelines.md 기준)
  const casinoLobbyGames = [
    { id: 410000, provider_id: 410, name: '에볼루션 게이밍 로비' },
    { id: 77060, provider_id: 77, name: '마이크로 게이밍 로비' },
    { id: 2029, provider_id: 2, name: 'Vivo 게이밍 로비' },
    { id: 30000, provider_id: 30, name: '아시아 게이밍 로비' },
    { id: 78001, provider_id: 78, name: '프라그마틱플레이 로비' },
    { id: 86001, provider_id: 86, name: '섹시게이밍 로비' },
    { id: 11000, provider_id: 11, name: '비비아이엔 로비' },
    { id: 28000, provider_id: 28, name: '드림게임 로비' },
    { id: 89000, provider_id: 89, name: '오리엔탈게임 로비' },
    { id: 91000, provider_id: 91, name: '보타 로비' },
    { id: 44006, provider_id: 44, name: '이주기 로비' },
    { id: 85036, provider_id: 85, name: '플레이텍 라이브 로비' },
    { id: 0, provider_id: 0, name: '제네럴 카지노 로비' }
  ];

  // 기존 카지노 로비 게임 확인
  const { data: existingCasinoGames } = await supabase
    .from('games')
    .select('id')
    .eq('type', 'casino');

  const existingIds = new Set(existingCasinoGames?.map(game => game.id) || []);

  // 누락된 카지노 로비 게임만 추가
  const missingGames = casinoLobbyGames.filter(game => 
    !existingIds.has(game.id) && 
    casinoProviders.some(provider => provider.id === game.provider_id)
  );

  if (missingGames.length > 0) {
    const gamesToInsert = missingGames.map(game => ({
      id: game.id,
      provider_id: game.provider_id,
      name: game.name,
      type: 'casino',
      status: 'visible',
      demo_available: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }));

    const { error: insertError } = await supabase
      .from('games')
      .insert(gamesToInsert);

    if (insertError) {
      console.error('카지노 로비 게임 추가 오류:', insertError);
    } else {
      console.log(`✅ ${missingGames.length}개 카지노 로비 게임 추가 완료`);
    }
  } else {
    console.log('✅ 카지노 로비 게임이 이미 모두 존재합니다.');
  }
}

// 동기화 결과 저장
async function saveSyncResult(
  providerId: number, 
  opcode: string, 
  syncType: string,
  gamesAdded: number,
  gamesUpdated: number,
  gamesRemoved: number,
  errorMessage?: string,
  syncDuration?: number
): Promise<number> {
  const { data, error } = await supabase
    .rpc('save_game_sync_result', {
      p_provider_id: providerId,
      p_opcode: opcode,
      p_sync_type: syncType,
      p_games_added: gamesAdded,
      p_games_updated: gamesUpdated,
      p_games_removed: gamesRemoved,
      p_error_message: errorMessage,
      p_sync_duration: syncDuration
    });

  if (error) {
    console.error('동기화 결과 저장 오류:', error);
    throw error;
  }

  return data;
}

// 사용자별 게임 목록 조회 (Opcode 기반)
async function getUserVisibleGames(
  userId: string, // UUID 타입으로 변경
  gameType?: string,
  providerId?: number,
  searchTerm?: string,
  limit: number = 50,
  offset: number = 0
): Promise<any[]> {
  const { data, error } = await supabase
    .rpc('get_user_visible_games', {
      p_user_id: userId,
      p_game_type: gameType,
      p_provider_id: providerId,
      p_search_term: searchTerm,
      p_limit: limit,
      p_offset: offset
    });

  if (error) {
    console.error('사용자 게임 목록 조회 오류:', error);
    throw error;
  }

  return data || [];
}

// 파트너별 게임 상태 업데이트
async function updateGameStatusForPartner(
  partnerId: string, // UUID 타입으로 변경
  gameId: number,
  status: string,
  priority?: number,
  isFeatured?: boolean
): Promise<boolean> {
  const { data, error } = await supabase
    .rpc('update_game_status_for_partner', {
      p_partner_id: partnerId,
      p_game_id: gameId,
      p_status: status,
      p_priority: priority,
      p_is_featured: isFeatured
    });

  if (error) {
    console.error('게임 상태 업데이트 오류:', error);
    throw error;
  }

  return data;
}

// 게임 실행 URL 생성 (관리자 API 테스터와 동일한 방식 사용)
async function generateGameLaunchUrl(
  userId: string, // UUID 타입 (string)
  gameId: number
): Promise<{ success: boolean; launchUrl?: string; sessionId?: number | null; error?: string }> {
  try {
    console.log('🎮 게임 실행 요청 시작:', { userId, gameId, userIdType: typeof userId });

    // 사용자 기본 정보 조회
    console.log('🔍 사용자 정보 조회 시작:', { userId, userIdType: typeof userId });
    
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('username, balance')
      .eq('id', userId)
      .single();

    console.log('🔍 사용자 조회 결과:', { userData, userError });

    if (userError) {
      console.error('❌ 사용자 조회 오류:', {
        error: userError,
        message: userError.message,
        details: userError.details,
        hint: userError.hint,
        code: userError.code
      });
      throw new Error(`사용자 정보 조회 실패: ${userError.message}`);
    }

    if (!userData) {
      console.error('❌ 사용자 데이터 없음:', { userId });
      throw new Error('사용자 정보를 찾을 수 없습니다.');
    }

    // 사용자의 OPCODE 정보 조회
    console.log('🔍 OPCODE 정보 조회 시작:', { userId });
    
    const { data: opcodeData, error: opcodeError } = await supabase
      .rpc('get_user_opcode_info', { user_id: userId });

    console.log('🔍 OPCODE 조회 결과:', { opcodeData, opcodeError });

    let opcode, secret_key, token;
    
    if (opcodeError || !opcodeData || !opcodeData.success) {
      console.error('❌ OPCODE 조회 실패:', opcodeData?.error || opcodeError?.message);
      console.log('🔄 시스템 관리자 OPCODE로 fallback');
      
      // Fallback: 시스템 관리자 OPCODE 사용
      const { data: systemOpcodeData, error: systemOpcodeError } = await supabase
        .from('partners')
        .select('opcode, secret_key, api_token')
        .eq('level', 1)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (systemOpcodeError || !systemOpcodeData) {
        throw new Error('시스템 OPCODE 정보를 찾을 수 없습니다. 관리자에게 문의하세요.');
      }

      if (!systemOpcodeData.api_token) {
        throw new Error('시스템 관리자의 API 토큰이 설정되지 않았습니다. partners 테이블에서 api_token을 설정하세요.');
      }

      opcode = systemOpcodeData.opcode;
      secret_key = systemOpcodeData.secret_key;
      token = systemOpcodeData.api_token;
    } else {
      opcode = opcodeData.opcode;
      secret_key = opcodeData.secret_key;
      token = opcodeData.api_token;
    }

    const { username, balance } = userData;
    
    // 필수 정보 검증
    if (!opcode || !secret_key || !token) {
      throw new Error('게임 실행에 필요한 API 정보가 부족합니다. 관리자에게 문의하세요.');
    }

    console.log('📊 API 호출 정보:', {
      username,
      balance,
      opcode,
      secret_key: secret_key ? '***' + secret_key.slice(-4) : 'null',
      token: token ? '***' + token.slice(-4) : 'null'
    });

    // 게임 정보 조회
    const { data: gameData, error: gameError } = await supabase
      .from('games')
      .select('id, name, external_game_id')
      .eq('id', gameId)
      .maybeSingle();

    if (gameError || !gameData) {
      throw new Error('게임 정보를 찾을 수 없습니다.');
    }

    // 외부 게임 ID 결정 (external_game_id가 있으면 사용, 없으면 내부 ID 사용)
    let gameExternalId = gameData.external_game_id;
    if (!gameExternalId || gameExternalId === null || gameExternalId === '') {
      // external_game_id가 없으면 내부 ID를 사용
      // Guidelines.md에 따르면 카지노는 로비 진입용 ID, 슬롯은 실제 game_id 사용
      gameExternalId = gameData.id;
    }
    
    console.log('🎮 investApi.launchGame 호출:', {
      opcode,
      username,
      token: token ? '***' + token.slice(-4) : 'null',
      gameId: gameExternalId,
      secret_key: secret_key ? '***' + secret_key.slice(-4) : 'null'
    });

    const result = await investApi.launchGame(opcode, username, token, gameExternalId, secret_key);
    
    console.log('🎮 investApi.launchGame 결과:', result);

    if (!result.success) {
      throw new Error(result.error || '게임 실행에 실패했습니다.');
    }

    // 게임 URL 추출
    const gameUrl = result.data?.game_url || result.data?.url || result.data?.launch_url || '';

    if (!gameUrl) {
      console.error('❌ 게임 URL을 찾을 수 없음:', result);
      throw new Error(result.error || '게임 실행 URL을 받지 못했습니다.');
    }

    console.log('✅ 게임 URL 획득');

    // 게임 실행 세션 저장

    const { data: sessionId, error: sessionError } = await supabase
      .rpc('save_game_launch_session', {
        p_user_id: userId,
        p_game_id: gameId,
        p_opcode: opcode,
        p_launch_url: gameUrl,
        p_session_token: result.data?.token || null,
        p_balance_before: balance || 0
      });

    if (sessionError) {
      console.error('❌ 게임 세션 저장 오류:', sessionError);
      console.error('❌ 오류 상세:', {
        code: sessionError.code,
        message: sessionError.message,
        details: sessionError.details,
        hint: sessionError.hint
      });
      
      // 30초 중복 방지 에러인 경우 사용자에게 친절한 메시지 전달
      if (sessionError.message && sessionError.message.includes('30초')) {
        return {
          success: false,
          error: '잠시 후에 다시 시도하세요. (게임 실행 대기 시간)',
          sessionId: null
        };
      }
      
      // 세션 저장 실패해도 게임 실행은 계속 진행 (다른 에러의 경우)
    } else if (sessionId === null || sessionId === undefined) {
      console.error('⚠️ 게임 세션 저장 실패: sessionId가 null입니다!');
      console.error('⚠️ 함수가 에러를 반환하지 않았지만 세션 ID가 null입니다.');
      console.error('⚠️ Supabase 로그를 확인하세요: https://nzuzzmaiuybzyndptaba.supabase.co/project/_/logs/postgres-logs');
    } else {
      console.log('✅ 게임 세션 저장 완료:', sessionId);
    }

    return {
      success: true,
      launchUrl: gameUrl,
      sessionId: sessionId || null
    };

  } catch (error) {
    console.error('❌ 게임 실행 오류:', error);
    
    const errorMessage = error instanceof Error ? error.message : '게임 실행 중 오류가 발생했습니다.';
    console.error('📝 반환할 오류 메시지:', errorMessage);
    
    return {
      success: false,
      error: errorMessage,
      sessionId: null
    };
  } finally {
    console.log('🔚 게임 실행 프로세스 종료');
  }
}

// 모든 제공사 게임 동기화 (관리자용)
async function syncAllProviderGames(targetOpcode?: string): Promise<{
  success: boolean;
  results: Array<{
    providerId: number;
    providerName: string;
    gamesAdded: number;
    gamesUpdated: number;
    error?: string;
  }>;
}> {
  console.log('🔄 모든 제공사 게임 동기화 시작');
  
  const results: Array<{
    providerId: number;
    providerName: string;
    gamesAdded: number;
    gamesUpdated: number;
    error?: string;
  }> = [];

  try {
    // 슬롯 제공사만 조회 (카지노는 로비 진입 방식)
    const { data: providers, error: providersError } = await supabase
      .from('game_providers')
      .select('id, name, type')
      .eq('type', 'slot')
      .eq('status', 'active');

    if (providersError) {
      throw providersError;
    }

    const opcode = targetOpcode || 'system_admin';
    
    // 각 제공사별로 순차 동기화 (병렬 처리하면 API 부하 가능성)
    for (const provider of providers || []) {
      try {
        console.log(`🎮 ${provider.name} (ID: ${provider.id}) 동기화 시작`);
        
        const syncResult = await syncGamesFromAPI(provider.id);
        
        results.push({
          providerId: provider.id,
          providerName: provider.name,
          gamesAdded: syncResult.newGames || 0,
          gamesUpdated: syncResult.updatedGames || 0
        });

        // API 부하 방지를 위한 대기 시간
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.error(`❌ ${provider.name} 동기화 실패:`, error);
        results.push({
          providerId: provider.id,
          providerName: provider.name,
          gamesAdded: 0,
          gamesUpdated: 0,
          error: error instanceof Error ? error.message : '알 수 없는 오류'
        });
      }
    }

    const totalAdded = results.reduce((sum, r) => sum + r.gamesAdded, 0);
    const totalUpdated = results.reduce((sum, r) => sum + r.gamesUpdated, 0);
    const failedCount = results.filter(r => r.error).length;

    console.log(`✅ 전체 동기화 완료`);
    console.log(`📊 결과: 신규 ${totalAdded}개, 업데이트 ${totalUpdated}개, 실패 ${failedCount}개`);

    return {
      success: failedCount === 0,
      results
    };

  } catch (error) {
    console.error('❌ 전체 동기화 실패:', error);
    return {
      success: false,
      results
    };
  }
}

// 게임 세션 저장 (SECURITY DEFINER 함수 호출)
async function saveGameSession(
  sessionId: string,
  userId: string,
  username: string,
  gameId: string,
  providerId: number,
  launchUrl?: string
): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('save_game_session', {
      p_session_id: sessionId,
      p_user_id: userId,
      p_username: username,
      p_game_id: gameId,
      p_provider_id: providerId,
      p_launch_url: launchUrl || null
    });

    if (error) {
      console.error('❌ 게임 세션 저장 실패:', error);
      return null;
    }

    console.log('✅ 게임 세션 저장 완료:', data);
    return data;
  } catch (error) {
    console.error('❌ 게임 세션 저장 오류:', error);
    return null;
  }
}

// 게임 세션 상태 업데이트 (SECURITY DEFINER 함수 호출)
async function updateGameSessionStatus(
  sessionId: string,
  status: string,
  endedAt?: string
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('update_game_session_status', {
      p_session_id: sessionId,
      p_status: status,
      p_ended_at: endedAt || null
    });

    if (error) {
      console.error('❌ 게임 세션 상태 업데이트 실패:', error);
      return false;
    }

    console.log('✅ 게임 세션 상태 업데이트 완료:', { sessionId, status });
    return data;
  } catch (error) {
    console.error('❌ 게임 세션 상태 업데이트 오류:', error);
    return false;
  }
}

// 게임 동기화 로그 기록 (SECURITY DEFINER 함수 호출)
async function logGameSync(
  syncType: string,
  providerId?: number,
  recordsCount: number = 0,
  success: boolean = true,
  errorMessage?: string
): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('log_game_sync', {
      p_sync_type: syncType,
      p_provider_id: providerId || null,
      p_records_count: recordsCount,
      p_success: success,
      p_error_message: errorMessage || null
    });

    if (error) {
      console.error('❌ 게임 동기화 로그 기록 실패:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('❌ 게임 동기화 로그 기록 오류:', error);
    return null;
  }
}

// gameApi 객체로 export
export const gameApi = {
  getProviders,
  getGames,
  updateGameStatus,
  syncGamesFromAPI,
  initializeGameProviders,
  initializeCasinoLobbyGames,
  saveSyncResult,
  getUserVisibleGames,
  updateGameStatusForPartner,
  generateGameLaunchUrl,
  launchGame: generateGameLaunchUrl, // launchGame alias 추가
  syncAllProviderGames,
  // 새로운 SECURITY DEFINER 함수들
  saveGameSession,
  updateGameSessionStatus,
  logGameSync
};