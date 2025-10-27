import{k as v,r as l,s as o,j as e,w as x,R as N,Y as S,t as d,B as I,Z as P}from"./index-DlK2WquE.js";import{D as E}from"./DataTable-DShsxcsG.js";import{A as K,a as O,b as U,c as z,d as W,e as G}from"./AdminDialog-e_e5blH4.js";import{M as g}from"./MetricCard-C4Jq9Aol.js";import{W as F}from"./wifi-DdiMjzIn.js";import{C}from"./clock-BsgtTRc8.js";import"./search-BrsHMGhG.js";/**
 * @license lucide-react v0.487.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const H=[["path",{d:"M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0",key:"1r0f0z"}],["circle",{cx:"12",cy:"10",r:"3",key:"ilqhr7"}]],Y=v("map-pin",H);/**
 * @license lucide-react v0.487.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Z=[["path",{d:"M12 2v10",key:"mnfbl"}],["path",{d:"M18.4 6.6a9 9 0 1 1-12.77.04",key:"obofu9"}]],J=v("power",Z);/**
 * @license lucide-react v0.487.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Q=[["rect",{width:"14",height:"20",x:"5",y:"2",rx:"2",ry:"2",key:"1yt0o3"}],["path",{d:"M12 18h.01",key:"mhygvu"}]],V=v("smartphone",Q);function ce({user:t}){const[i,D]=l.useState([]),[$,b]=l.useState(!0),[f,y]=l.useState(null),[M,p]=l.useState(!1),[w,k]=l.useState(null),m=l.useRef(null),u=async(a=!1)=>{try{a&&b(!0);let s=[];t.level!==1&&(s=await B(t.id));let n=o.from("game_launch_sessions").select(`
          id,
          user_id,
          game_id,
          status,
          launched_at,
          last_activity_at,
          balance_before,
          users!inner (
            id,
            username,
            nickname,
            balance,
            vip_level,
            referrer_id,
            partners!users_referrer_id_fkey (
              id,
              nickname
            )
          ),
          games (
            name,
            game_providers (
              name
            )
          )
        `).eq("status","online").order("launched_at",{ascending:!1});if(t.level!==1)if(s.length===0)n=n.eq("users.referrer_id",t.id);else{const r=[t.id,...s];n=n.in("users.referrer_id",r)}const{data:c,error:h}=await n;if(h)throw h;const j=(c||[]).map(r=>({session_id:r.id,user_id:r.users.id,username:r.users.username,nickname:r.users.nickname||r.users.username,partner_nickname:r.users.partners?.nickname||"-",game_name:r.games?.name||"Unknown Game",provider_name:r.games?.game_providers?.name||"Unknown",balance_before:r.balance_before||0,current_balance:r.users.balance||0,vip_level:r.users.vip_level||0,device_type:"Web",ip_address:"-",location:"-",launched_at:r.launched_at,last_activity:r.last_activity_at||r.launched_at}));D(j)}catch(s){console.error("온라인 세션 로드 오류:",s),a&&d.error("온라인 현황을 불러올 수 없습니다")}finally{a&&b(!1)}},B=async a=>{const s=[],n=[a];for(;n.length>0;){const c=n.shift(),{data:h,error:j}=await o.from("partners").select("id").eq("parent_id",c);if(!j&&h)for(const r of h)s.push(r.id),n.push(r.id)}return s},T=async a=>{try{k(a.user_id);const s=await(void 0)(t.id),n=await P(s.opcode,a.username,s.token,s.secret_key);if(n&&n.balance!==void 0){const{error:c}=await o.from("users").update({balance:n.balance}).eq("id",a.user_id);if(c)throw c;d.success(`${a.nickname}의 보유금이 동기화되었습니다`),u()}else d.error("보유금 조회에 실패했습니다")}catch(s){console.error("보유금 동기화 오류:",s),d.error("보유금 동기화 중 오류가 발생했습니다")}finally{k(null)}},q=async()=>{if(f)try{const{error:a}=await o.from("game_launch_sessions").update({status:"ended",ended_at:new Date().toISOString()}).eq("id",f.session_id);if(a)throw a;d.success(`${f.nickname}의 세션이 종료되었습니다`),p(!1),y(null),u()}catch(a){console.error("세션 종료 오류:",a),d.error("세션 종료 중 오류가 발생했습니다")}};l.useEffect(()=>{u(!0)},[t.id]),l.useEffect(()=>{console.log("🔔 Realtime 구독 시작: game_launch_sessions");const a=o.channel("online-users-realtime").on("postgres_changes",{event:"*",schema:"public",table:"game_launch_sessions"},s=>{console.log("🔔 game_launch_sessions 변경 감지:",s),m.current&&clearTimeout(m.current),m.current=setTimeout(()=>{u()},500)}).subscribe();return()=>{o.removeChannel(a),m.current&&clearTimeout(m.current)}},[t.id]);const A=a=>{const s=Math.floor((Date.now()-new Date(a).getTime())/1e3/60);if(s<60)return`${s}분`;const n=Math.floor(s/60),c=s%60;return`${n}시간 ${c}분`},L=i.reduce((a,s)=>a+s.current_balance,0),_=i.reduce((a,s)=>a+(s.current_balance-s.balance_before),0),R=[{header:"사용자",cell:a=>e.jsxs("div",{className:"flex flex-col gap-1",children:[e.jsxs("div",{className:"flex items-center gap-2",children:[e.jsx("span",{children:a.username}),e.jsx(I,{variant:"outline",className:"text-xs",children:a.nickname})]}),e.jsxs("span",{className:"text-xs text-muted-foreground",children:["소속: ",a.partner_nickname]})]})},{header:"게임",cell:a=>e.jsxs("div",{className:"flex flex-col gap-1",children:[e.jsx("span",{className:"text-sm",children:a.game_name}),e.jsx("span",{className:"text-xs text-muted-foreground",children:a.provider_name})]})},{header:"게임 시작금",cell:a=>e.jsxs("span",{children:["₩",a.balance_before.toLocaleString()]})},{header:"현재 보유금",cell:a=>{const s=a.current_balance-a.balance_before;return e.jsxs("div",{className:"flex flex-col gap-1",children:[e.jsxs("span",{children:["₩",a.current_balance.toLocaleString()]}),e.jsxs("span",{className:`text-xs ${s>=0?"text-green-500":"text-red-500"}`,children:[s>=0?"+":"",s.toLocaleString()]})]})}},{header:"접속 정보",cell:a=>e.jsxs("div",{className:"flex flex-col gap-1 text-xs",children:[e.jsxs("div",{className:"flex items-center gap-1",children:[e.jsx(Y,{className:"h-3 w-3"}),e.jsx("span",{children:a.location})]}),e.jsxs("div",{className:"flex items-center gap-1",children:[e.jsx(V,{className:"h-3 w-3"}),e.jsx("span",{children:a.ip_address})]})]})},{header:"세션 시간",cell:a=>e.jsxs("div",{className:"flex items-center gap-1 text-xs",children:[e.jsx(C,{className:"h-3 w-3"}),e.jsx("span",{children:A(a.launched_at)})]})},{header:"관리",cell:a=>e.jsxs("div",{className:"flex gap-2",children:[e.jsx(x,{size:"sm",variant:"outline",onClick:()=>T(a),disabled:w===a.user_id,children:e.jsx(N,{className:`h-3 w-3 ${w===a.user_id?"animate-spin":""}`})}),e.jsx(x,{size:"sm",variant:"destructive",onClick:()=>{y(a),p(!0)},children:e.jsx(J,{className:"h-3 w-3"})})]})}];return e.jsxs("div",{className:"space-y-6",children:[e.jsxs("div",{className:"flex items-center justify-between",children:[e.jsxs("div",{children:[e.jsx("h2",{className:"text-2xl",children:"온라인 현황"}),e.jsx("p",{className:"text-sm text-muted-foreground mt-1",children:"실시간 게임 중인 사용자 현황"})]}),e.jsxs(x,{onClick:()=>u(!0),variant:"outline",children:[e.jsx(N,{className:"h-4 w-4 mr-2"}),"새로고침"]})]}),e.jsxs("div",{className:"grid gap-5 md:grid-cols-2 lg:grid-cols-4",children:[e.jsx(g,{title:"온라인 사용자",value:`${i.length}명`,subtitle:"현재 게임 중",icon:F,color:"purple"}),e.jsx(g,{title:"총 게임 보유금",value:`₩${L.toLocaleString()}`,subtitle:"전체 게임 중 보유금",icon:S,color:"pink"}),e.jsx(g,{title:"총 손익",value:`${_>=0?"+":""}₩${_.toLocaleString()}`,subtitle:"게임 시작 대비",icon:S,color:_>=0?"green":"red"}),e.jsx(g,{title:"평균 세션",value:i.length>0?`${Math.floor(i.reduce((a,s)=>a+(Date.now()-new Date(s.launched_at).getTime()),0)/i.length/1e3/60)}분`:"0분",subtitle:"평균 게임 시간",icon:C,color:"cyan"})]}),$?e.jsx("div",{className:"flex items-center justify-center py-12",children:e.jsxs("div",{className:"text-center space-y-2",children:[e.jsx("div",{className:"w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto"}),e.jsx("p",{className:"text-sm text-muted-foreground",children:"로딩 중..."})]})}):e.jsx(E,{data:i,columns:R,emptyMessage:"현재 게임 중인 사용자가 없습니다",rowKey:"session_id"}),e.jsx(K,{open:M,onOpenChange:p,children:e.jsxs(O,{children:[e.jsxs(U,{children:[e.jsx(z,{children:"세션 강제 종료"}),e.jsxs(W,{children:[f?.nickname,"님의 게임 세션을 강제로 종료하시겠습니까?"]})]}),e.jsxs(G,{children:[e.jsx(x,{variant:"outline",onClick:()=>p(!1),children:"취소"}),e.jsx(x,{variant:"destructive",onClick:q,children:"종료"})]})]})})]})}export{ce as OnlineUsers};
