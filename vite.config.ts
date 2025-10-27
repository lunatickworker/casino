import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    extensions: [".js", ".jsx", ".ts", ".tsx", ".json"],
    alias: {
      "vaul@1.1.2": "vaul",
      "sonner@2.0.3": "sonner",
      "recharts@2.15.2": "recharts",
      "react-resizable-panels@2.1.7": "react-resizable-panels",
      "react-hook-form@7.55.0": "react-hook-form",
      "react-day-picker@8.10.1": "react-day-picker",
      "next-themes@0.4.6": "next-themes",
      "lucide-react@0.487.0": "lucide-react",
      "input-otp@1.4.2": "input-otp",
      "embla-carousel-react@8.6.0": "embla-carousel-react",
      "cmdk@1.1.1": "cmdk",
      "class-variance-authority@0.7.1":
        "class-variance-authority",
      "@radix-ui/react-tooltip@1.1.8":
        "@radix-ui/react-tooltip",
      "@radix-ui/react-toggle@1.1.2": "@radix-ui/react-toggle",
      "@radix-ui/react-toggle-group@1.1.2":
        "@radix-ui/react-toggle-group",
      "@radix-ui/react-tabs@1.1.3": "@radix-ui/react-tabs",
      "@radix-ui/react-switch@1.1.3": "@radix-ui/react-switch",
      "@radix-ui/react-slot@1.1.2": "@radix-ui/react-slot",
      "@radix-ui/react-slider@1.2.3": "@radix-ui/react-slider",
      "@radix-ui/react-separator@1.1.2":
        "@radix-ui/react-separator",
      "@radix-ui/react-select@2.1.6": "@radix-ui/react-select",
      "@radix-ui/react-scroll-area@1.2.3":
        "@radix-ui/react-scroll-area",
      "@radix-ui/react-radio-group@1.2.3":
        "@radix-ui/react-radio-group",
      "@radix-ui/react-popover@1.1.6":
        "@radix-ui/react-popover",
      "@radix-ui/react-navigation-menu@1.2.5":
        "@radix-ui/react-navigation-menu",
      "@radix-ui/react-menubar@1.1.6":
        "@radix-ui/react-menubar",
      "@radix-ui/react-label@2.1.2": "@radix-ui/react-label",
      "@radix-ui/react-hover-card@1.1.6":
        "@radix-ui/react-hover-card",
      "@radix-ui/react-dropdown-menu@2.1.6":
        "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-dialog@1.1.6": "@radix-ui/react-dialog",
      "@radix-ui/react-context-menu@2.2.6":
        "@radix-ui/react-context-menu",
      "@radix-ui/react-collapsible@1.1.3":
        "@radix-ui/react-collapsible",
      "@radix-ui/react-checkbox@1.1.4":
        "@radix-ui/react-checkbox",
      "@radix-ui/react-avatar@1.1.3": "@radix-ui/react-avatar",
      "@radix-ui/react-aspect-ratio@1.1.2":
        "@radix-ui/react-aspect-ratio",
      "@radix-ui/react-alert-dialog@1.1.6":
        "@radix-ui/react-alert-dialog",
      "@radix-ui/react-accordion@1.2.3":
        "@radix-ui/react-accordion",
      "@jsr/supabase__supabase-js@2.49.8":
        "@jsr/supabase__supabase-js",
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    target: "esnext",
    outDir: "dist",
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // React 관련 핵심 라이브러리
          if (id.includes('node_modules/react/') || 
              id.includes('node_modules/react-dom/') || 
              id.includes('node_modules/scheduler/')) {
            return 'react-core';
          }
          
          // React Router
          if (id.includes('node_modules/react-router') || 
              id.includes('node_modules/@remix-run')) {
            return 'react-router';
          }
          
          // Radix UI 컴포넌트들
          if (id.includes('node_modules/@radix-ui/')) {
            return 'radix-ui';
          }
          
          // Lucide 아이콘
          if (id.includes('node_modules/lucide-react/')) {
            return 'lucide-icons';
          }
          
          // Recharts
          if (id.includes('node_modules/recharts/') || 
              id.includes('node_modules/recharts-scale/') || 
              id.includes('node_modules/victory-')) {
            return 'recharts';
          }
          
          // Supabase
          if (id.includes('node_modules/@supabase/') || 
              id.includes('node_modules/@jsr/supabase') || 
              id.includes('supabase-js')) {
            return 'supabase';
          }
          
          // 기타 vendor 라이브러리들
          if (id.includes('node_modules/')) {
            return 'vendor';
          }
          
          // 관리자 컴포넌트들 - 핵심
          if (id.includes('/components/admin/Dashboard') || 
              id.includes('/components/admin/AdminLogin')) {
            return 'admin-core';
          }
          
          // 관리자 컴포넌트들 - 사용자 관리
          if (id.includes('/components/admin/UserManagement') || 
              id.includes('/components/admin/UserDetailModal') || 
              id.includes('/components/admin/PartnerManagement') || 
              id.includes('/components/admin/PartnerCreation')) {
            return 'admin-users';
          }
          
          // 관리자 컴포넌트들 - 거래 관리
          if (id.includes('/components/admin/TransactionManagement') || 
              id.includes('/components/admin/TransactionApprovalManager') || 
              id.includes('/components/admin/PartnerTransactions') || 
              id.includes('/components/admin/ForceTransactionModal')) {
            return 'admin-transactions';
          }
          
          // 관리자 컴포넌트들 - 베팅 및 게임
          if (id.includes('/components/admin/BettingManagement') || 
              id.includes('/components/admin/BettingHistory') || 
              id.includes('/components/admin/EnhancedGameManagement') || 
              id.includes('/components/admin/BettingHistorySync')) {
            return 'admin-betting';
          }
          
          // 관리자 컴포넌트들 - 시스템
          if (id.includes('/components/admin/SystemSettings') || 
              id.includes('/components/admin/MenuManagement') || 
              id.includes('/components/admin/BalanceSyncManager') || 
              id.includes('/components/admin/AutoSyncMonitor') || 
              id.includes('/components/admin/ApiTester')) {
            return 'admin-system';
          }
          
          // 관리자 컴포넌트들 - 기타
          if (id.includes('/components/admin/')) {
            return 'admin-others';
          }
          
          // 사용자 컴포넌트들
          if (id.includes('/components/user/')) {
            return 'user-components';
          }
          
          // 공통 컴포넌트들
          if (id.includes('/components/common/')) {
            return 'common-components';
          }
          
          // UI 컴포넌트들
          if (id.includes('/components/ui/')) {
            return 'ui-components';
          }
          
          // Contexts
          if (id.includes('/contexts/')) {
            return 'contexts';
          }
          
          // Hooks와 Utils
          if (id.includes('/hooks/') || id.includes('/lib/') || id.includes('/utils/')) {
            return 'utils';
          }
        },
      },
    },
    chunkSizeWarningLimit: 600,
    sourcemap: false,
  },
  server: {
    port: 3000,
    open: true,
  },
});