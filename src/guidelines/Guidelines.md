# Invest API 연동 메뉴얼

## 기본 정보
- **Base URL**: `https://api.invest-ho.com`
- **OPCODE**: `입력된 opcode` (동적 파라미터)
- **Secret Key**: `입력된 고유키` (동적 파라미터)
- **Content-Type**: `application/json`
- **token**: `대본사 생성시 입력된 토큰값` (영구사용)

## 서명(Signature) 생성 방법
```
utf-8 함수로 변환 후 md5(signature) 생성
```

---

## 1. 계정 관련 API

### 1.1 계정 생성 및 로그인
```
POST /api/account
```

**Body:**
```json
{
  "opcode": "입력된 opcode",
  "username": "사용할 회원ID",
  "signature": "조합된 signature 값"
}
```

**Signature:** `md5(opcode + username + secret_key)`

**특징:**
- 대본사 생성시 입력된 토큰값
- 1회 호출 후 더 이상 호출하지 않으면 token은 영구 유지


### 1.3 전체 계정 잔고 조회
```
PATCH /api/account/balance
```

**Body:**
```json
{
  "opcode": "입력된 opcode",
  "signature": "조합된 signature 값"
}
```

**Signature:** `md5(opcode + secret_key)`

**특징:**
- 모든 회원의 잔고를 일괄 조회
- 30초 이상 간격으로 호출 권장
- 최근 2일 이내 업데이트된 회원만 조회됨

---

### 1.4 계정 입금
```
POST /api/account/balance
```

**Body:**
```json
{
  "opcode": "입력된 opcode",
  "username": "회원ID",
  "token": "대본사 생성시 입력된 토큰값",
  "amount": 입금액(숫자만),
  "signature": "조합된 signature 값"
}
```

**Signature:** `md5(opcode + username + token + amount + secret_key)`

**응답:** 충전된 금액과 현재 잔고 반환

---

### 1.5 계정 출금
```
PUT /api/account/balance
```

**Body:**
```json
{
  "opcode": "입력된 opcode",
  "username": "회원ID",
  "token": "대본사 생성시 입력된 토큰값",
  "amount": 출금액(숫자만),
  "signature": "조합된 signature 값"
}
```

**Signature:** `md5(opcode + username + token + amount + secret_key)`

**응답:** 출금된 금액과 현재 잔고 반환

---

### 1.6 계정 전체 출금 (현재 사용 안함)
```
DELETE /api/account/balance
```

**참고:** 현재 지원하지 않음. 일반 출금 API 사용 권장

---

### 1.7 사용자 입출금 기록 조회
```
VIEW /api/account/balance
```

**Body:**
```json
{
  "opcode": "입력된 opcode",
  "username": "회원ID",
  "date_from": "시작일자(yyyy-mm-dd)",
  "date_to": "끝일자(yyyy-mm-dd)",
  "signature": "조합된 signature 값"
}
```

**Signature:** `md5(opcode + username + date_from + date_to + secret_key)`

**용도:** 참고용 확인 및 잔고 변동 분석

---

### 1.8 기본정보 기록 조회
```
GET /api/info
```

**Body:**
```json
{
    "opcode": "입력된 opcode",
	"signature":"조합된 signature 값" // opcode + secret_key
}
```

**Signature:** `md5(opcode + secret_key)`

**용도:** opcode 잔고 조회

---

### 1.9 사용자 보유금 조회
```
GET /api/account/balance
```

**Body:**
```json
{
    "opcode": "입력된 opcode",
	"username"" "회원ID",
	"token": "대본사 생성시 입력된 토큰값",
	"signature":"조합된 signature 값" // opcode + username + token + secret_key
}
```

**Signature:** `md5(opcode + username + token + secret_key)`

**용도:** 보유금 조회
---

## 2. 게임 관련 API

### 2.1 게임 목록 조회
```
GET /api/game/lists
```

**Body:**
```json
{
  "opcode": "입력된 opcode",
  "provider_id": 게임공급사ID(숫자),
  "signature": "조합된 signature 값"
}
```

**Signature:** `md5(opcode + provider_id + secret_key)`

**참고:** 카지노의 경우 게임 목록이 없을 수 있음 (로비 진입 방식)

---

### 2.2 게임 실행
```
POST /api/game/launch
```

**Body:**
```json
{
  "opcode": "입력된 opcode",
  "username": "회원ID",
  "token": "대본사 생성시 입력된 토큰값",
  "game": game_id,
  "signature": "조합된 signature 값"
}
```

**Signature:** `md5(opcode + username + token + game + secret_key)`

**게임 ID 설명:**
- **슬롯**: 각 게임사 목록의 실제 game_id 사용
- **카지노**: 로비 진입용 game_id 사용 (예: 410000 = 에볼루션)
- **Provider_id 계산**: game_id ÷ 1000의 몫

---

### 2.3 게임 기록 조회 (인덱스 방식)
```
GET /api/game/historyindex
```

**Body:**
```json
{
  "opcode": "입력된 opcode",
  "year": "조회연도(YYYY)",
  "month": "조회월(M)",
  "index": 조회시작인덱스(숫자),
  "limit": 최대조회개수(최대4000, 기본1000),
  "signature": "조합된 signature 값"
}
```

**Signature:** `md5(opcode + year + month + index + secret_key)`

**특징:**
- 마지막 조회한 데이터의 ID를 다음 index로 사용
- 누락 없는 연속 데이터 조회 가능
- 최소 30초 간격으로 호출 권장

---

### 2.4 라운드 상세 정보
```
GET /api/game/detail
```

**Body:**
```json
{
  "opcode": "입력된 opcode",
  "yyyymm": "조회년월(YYYYMM)",
  "txid": 상세조회할txid(숫자),
  "signature": "조합된 signature 값"
}
```

**Signature:** `md5(opcode + yyyymm + txid + secret_key)`

**참고:** 모든 게임사가 상세 데이터를 지원하지는 않음

---

### 2.5 에볼 배팅 금액 제한
► URL : https://api.invest-ho.com/api/game/limit
► Method : PUT
► Content-type : application/json
► Signatuere : tolower( md5 ( opcode + secret_key ) )
► Body
► {
► "opcode" : " 발급받은 OPCODE",
► "signature" : " 조합된 signature 값 ＂
► “limit” : “ 제한할 배팅 금액 ＂
► }
► 예)
► Result
► 정상 응답
► 그 외 비정상 응답의 경우 응답페이지 참조
► 결과는 Result 로 true / false 로 나오며, 적용된 데이터 확인은 아래 limit 데이터를
확인하시면 됩니다.


### 2.6 에볼루션 최대배팅금 셋팅
► URL : https://api.invest-ho.com/api/game/limit
► Method : PUT
► Content-type : application/json
► Signatuere : tolower( md5 ( opcod + secret_key ) )
► Body
► {
► "opcode" : "발급받은 OPCODE",
► “users" : [“셋팅하고자하는 유저이름을 배열로 입력 ”],
► “limit" : 셋팅하고자하는 최대베팅금액(최대 1억) 입력,
► “signature" : ＂조합된 signature 값＂
► }
► 예)
► Result
► 정상응답
► 그 외 비정상 응답의 경우 응답페이지 참조
► Users 데이터를 미입력 시 , 본사가 바뀌므로 꼭 users에 해당유저의 값을 넣어주세요.


### 2.7 에볼루션 최대배팅 설정 값 가져오기
► URL : https://api.invest-ho.com/api/game/limit
► Method : GET
► Content-type : application/json
► Signatuere : tolower( md5 ( opcod + secret_key ) )
► Body
► {
► "opcode" : "발급받은 OPCODE",
► “signature" : ＂조합된 signature 값＂
► }
► 예)
► Result
► 정상응답
► 그 외 비정상 응답의 경우 응답페이지 참조
► 매장 설정 값은 [limit]
유저들 설정 값은 [users] 배열 정보로 받아 보실 수 있습니다.



## 3. 주의사항

### 3.1 "알 사라짐" 현상 방지
다음과 같은 경우 게임머니가 사라질 수 있습니다:

1. **지원하지 않는 Provider나 Game ID 사용**
2. **빠른 게임사 간 이동**
   - 지갑 변경 처리 중에 다른 게임사로 이동
   - 서로 다른 지갑을 사용하는 게임사 간 이동

### 3.2 대표 게임사 지갑 구분
- 프라그마틱
- 에볼루션  
- 부운고 & 플레이선
- 기타

### 3.3 해결 방안
- 게임 실행 전 입금 처리 완료 확인
- 다른 게임사 간 이동 시 **최소 30초 간격** 유지
- 같은 게임사 내 이동은 제한 없음

---

## 4. 지원 게임 공급사

### 4.1 슬롯 공급사
| Provider ID | 게임사명 |
|-------------|----------|
1: 마이크로게이밍

17: 플레이앤고

20: CQ9 게이밍

21: 제네시스 게이밍

22: 하바네로

23: 게임아트

27: 플레이텍

38: 블루프린트

39: 부운고

40: 드라군소프트

41: 엘크 스튜디오

47: 드림테크

51: 칼람바 게임즈

52: 모빌롯

53: 노리밋 시티

55: OMI 게이밍

56: 원터치

59: 플레이슨

60: 푸쉬 게이밍

61: 퀵스핀

62: RTG 슬롯

63: 리볼버 게이밍

65: 슬롯밀

66: 스피어헤드

70: 썬더킥

72: 우후 게임즈

74: 릴렉스 게이밍

75: 넷엔트

76: 레드타이거

87: PG소프트

88: 플레이스타

90: 빅타임게이밍

300: 프라그마틱 플레이

### 4.2 카지노 공급사 (로비 진입용 Game ID)
| Game ID | 게임사명 |
|---------|----------|
410000: 에볼루션 게이밍

77060: 마이크로 게이밍

2029: Vivo 게이밍

30000: 아시아 게이밍

78001: 프라그마틱플레이

86001: 섹시게이밍

11000: 비비아이엔

28000: 드림게임

89000: 오리엔탈게임

91000: 보타

44006: 이주기

85036: 플레이텍 라이브

      0: 제네럴 카지노

**참고:** 지원하지 않는 게임사 사용 시 기록 누락이나 잔고 사라짐 현상 발생 가능


### 외부 api 호출 시 proxy 서버 경유 정보
```
url : https://vi8282.com/proxy
method : POST
호출 Body 형식 : 
{
  "url": "https://api.invest-ho.com/api/game/lists",
  "method": "GET",
  "headers": {
    "Content-Type": "application/json"
  },
  "body": {
    "opcode": "입력된 opcode",
    "provider_id":게임공급사ID(숫자) ,
    "signature": "조합된 signature 값"
  }
}


### websocket  사용 정보
1. 사용자페이지 <-> 관리자페이지 간 모든 연동
2. 외부 API와 연동되는 기능은 모두 외부 API와 연동과 함께 실시간(websocket) 업데이트
3. websocket add : wws://vi8282.com/ws

### 구현 방법
1. api 응답 직접 파싱 방법 사용(josb 사용 금지)
2. realtime subscription / optimstic hook 사용
3. 사용자페이지 / 관리자페이지로 완전 분리하고, 브라우저 로딩시 메모리 사용을 최적화 하기 위해 컨포넌트를 계속 만들지 말고 최대한 재사용한다.
4. proxy server(https://vi8282.com/proxy)로 직접 호출
5. mock 데이터는 만들지 않는다. (에러나면 직접 해결을 해야한다)
6. DB 스키마 생성시는 기존에 스키마를 확인하고 컬럼규칙 일관성있게 맞추고 만든다.
7. 관리자는 7단계로 만들고(시스템관리자/대본사/본사/부본사/총판/매장/사용자)->menufunction.md 분석해라.

### 기초정보
VITE_SUPABASE_URL=https://nzuzzmaiuybzyndptaba.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im56dXp6bWFpdXlienluZHB0YWJhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkyMDM5NDMsImV4cCI6MjA3NDc3OTk0M30.XLuJJG-KhlmRrFYsIZsF_iINbJ9iWPhJ3q4Cby1_WJU
Service_role_key=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im56dXp6bWFpdXlienluZHB0YWJhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1OTIwMzk0MywiZXhwIjoyMDc0Nzc5OTQzfQ.ITQXw1UhEdqMvTNcWFi1WJVO4npUDCCG7G96EkjQMh
