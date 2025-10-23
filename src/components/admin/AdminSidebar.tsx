import { useState, useEffect } from "react";
import { cn } from "../../lib/utils";
import { supabase } from "../../lib/supabase";
import { Partner } from "../../types";
import {
  LayoutDashboard,
  Users,
  Shield,
  TrendingUp,
  Activity,
  Building2,
  CreditCard,
  Calculator,
  Database,
  Gamepad2,
  RefreshCw,
  HelpCircle,
  Bell,
  MessageSquare,
  Settings,
  Image,
  Menu,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

interface MenuItem {
  id: string;
  title: string;
  icon: React.ComponentType<any>;
  path?: string;
  minLevel?: number;
  children?: MenuItem[];
  parent_menu?: string;
}

interface DbMenuItem {
  menu_id: string;
  menu_name: string;
  menu_path: string;
  parent_menu: string | null;
  display_order: number;
}

const iconMap: Record<string, React.ComponentType<any>> = {
  '/admin/dashboard': LayoutDashboard,
  '/admin/realtime': Activity,
  '/admin/users': Users,
  '/admin/user-management': Users,
  '/admin/blacklist': Shield,
  '/admin/points': TrendingUp,
  '/admin/online': Activity,
  '/admin/online-users': Activity,
  '/admin/online-status': Activity,
  '/admin/logs': Database,
  '/admin/head-office': Building2,
  '/admin/partners/master': Building2,
  '/admin/partners': Building2,
  '/admin/partner-hierarchy': Building2,
  '/admin/partner-transactions': CreditCard,
  '/admin/partners/transactions': CreditCard,
  '/admin/partner-online': Activity,
  '/admin/partners/status': Activity,
  '/admin/partner-dashboard': LayoutDashboard,
  '/admin/partners/dashboard': LayoutDashboard,
  '/admin/settlement': Calculator,
  '/admin/commission-settlement': Calculator,
  '/admin/settlement/commission': Calculator,
  '/admin/integrated-settlement': Database,
  '/admin/settlement/integrated': Database,
  '/admin/transactions': CreditCard,
  '/admin/transaction-approval': CreditCard,
  '/admin/games': Gamepad2,
  '/admin/game-lists': Gamepad2,
  '/admin/betting': TrendingUp,
  '/admin/betting-history': TrendingUp,
  '/admin/betting-management': TrendingUp,
  '/admin/call-cycle': RefreshCw,
  '/admin/communication': MessageSquare,
  '/admin/customer-service': HelpCircle,
  '/admin/support': HelpCircle,
  '/admin/announcements': Bell,
  '/admin/messages': MessageSquare,
  '/admin/settings': Settings,
  '/admin/system-settings': Settings,
  '/admin/system': Activity,
  '/admin/system-info': Activity,
  '/admin/api-tester': Settings,
  '/admin/banners': Image,
  '/admin/menu-management': Menu,
  '/admin/auto-sync-monitor': RefreshCw,
};

const getGroupIcon = (groupName: string): React.ComponentType<any> => {
  const lowerName = groupName.toLowerCase();
  if (lowerName.includes('회원')) return Users;
  if (lowerName.includes('파트너')) return Building2;
  if (lowerName.includes('정산') || lowerName.includes('거래')) return Calculator;
  if (lowerName.includes('게임')) return Gamepad2;
  if (lowerName.includes('커뮤') || lowerName.includes('메시지')) return MessageSquare;
  if (lowerName.includes('시스템') || lowerName.includes('설정')) return Settings;
  return Settings;
};

interface AdminSidebarProps {
  user: Partner;
  className?: string;
  onNavigate?: (route: string) => void;
  currentRoute?: string;
}

export function AdminSidebar({ user, className, onNavigate, currentRoute }: AdminSidebarProps) {
  const [expandedItems, setExpandedItems] = useState<string[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loadingMenus, setLoadingMenus] = useState(true);

  useEffect(() => {
    loadMenusFromDB();
  }, [user.id]);

  const loadMenusFromDB = async () => {
    if (!user?.id) return;
    
    setLoadingMenus(true);
    try {
      const { data, error } = await supabase
        .rpc('get_partner_enabled_menus', { p_partner_id: user.id });

      const dashboardMenu: MenuItem = {
        id: 'dashboard',
        title: '대시보드',
        icon: LayoutDashboard,
        path: '/admin/dashboard',
        minLevel: 6
      };

      if (error || !data || data.length === 0) {
        setMenuItems([dashboardMenu]);
      } else {
        const dbMenus = data as DbMenuItem[];
        const converted = convertDbMenusToMenuItems(dbMenus);
        const hasDashboard = converted.some(m => m.path === '/admin/dashboard');
        setMenuItems(hasDashboard ? converted : [dashboardMenu, ...converted]);
      }
    } catch (error) {
      setMenuItems([{
        id: 'dashboard',
        title: '대시보드',
        icon: LayoutDashboard,
        path: '/admin/dashboard',
        minLevel: 6
      }]);
    } finally {
      setLoadingMenus(false);
    }
  };

  const convertDbMenusToMenuItems = (dbMenus: DbMenuItem[]): MenuItem[] => {
    const groupedByParent = dbMenus.reduce((acc, menu) => {
      const parent = menu.parent_menu || 'root';
      if (!acc[parent]) acc[parent] = [];
      acc[parent].push(menu);
      return acc;
    }, {} as Record<string, DbMenuItem[]>);

    const rootMenus = (groupedByParent['root'] || []).sort((a, b) => a.display_order - b.display_order);
    
    const groupOrderMap: Record<string, number> = {};
    Object.keys(groupedByParent).forEach(groupName => {
      if (groupName !== 'root') {
        const menus = groupedByParent[groupName];
        groupOrderMap[groupName] = Math.min(...menus.map(m => m.display_order));
      }
    });

    const allItems: Array<{ type: 'group' | 'single', order: number, item: MenuItem }> = [];

    rootMenus.forEach(menu => {
      allItems.push({
        type: 'single',
        order: menu.display_order,
        item: {
          id: menu.menu_id,
          title: menu.menu_name,
          icon: iconMap[menu.menu_path] || Settings,
          path: menu.menu_path,
          minLevel: 6
        }
      });
    });

    const processedGroups = new Set<string>();
    
    Object.keys(groupedByParent).forEach(groupName => {
      if (groupName !== 'root' && !processedGroups.has(groupName)) {
        processedGroups.add(groupName);
        
        const childrenMenus = groupedByParent[groupName].sort((a, b) => a.display_order - b.display_order);
        const children: MenuItem[] = childrenMenus.map(child => ({
          id: child.menu_id,
          title: child.menu_name,
          icon: iconMap[child.menu_path] || Settings,
          path: child.menu_path,
          minLevel: 6,
          parent_menu: child.parent_menu || undefined
        }));

        allItems.push({
          type: 'group',
          order: groupOrderMap[groupName] || 999,
          item: {
            id: `group-${groupName}`,
            title: groupName,
            icon: getGroupIcon(groupName),
            minLevel: 6,
            children: children
          }
        });
      }
    });

    return allItems.sort((a, b) => a.order - b.order).map(item => item.item);
  };

  const toggleExpanded = (id: string) => {
    setExpandedItems(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const renderMenuItem = (item: MenuItem, depth: number = 0) => {
    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = expandedItems.includes(item.id);
    const isActive = currentRoute === item.path;
    const Icon = item.icon;

    return (
      <div key={item.id}>
        <button
          onClick={() => {
            if (hasChildren) {
              toggleExpanded(item.id);
            } else {
              if (item.path && onNavigate) {
                onNavigate(item.path);
              }
            }
          }}
          className={cn(
            "w-full flex items-center gap-2 px-3 py-2.5 rounded-lg transition-all duration-200",
            "text-sm group relative",
            isActive
              ? "bg-gradient-to-r from-blue-600/20 to-purple-600/20 text-white border border-blue-500/30"
              : "text-slate-300 hover:bg-slate-800/50 hover:text-white",
            depth > 0 && "ml-4"
          )}
        >
          <Icon className={cn(
            "w-4 h-4 flex-shrink-0",
            isActive ? "text-blue-400" : "text-slate-400 group-hover:text-blue-400"
          )} />
          <span className="flex-1 text-left truncate overflow-hidden text-ellipsis whitespace-nowrap">
            {item.title}
          </span>
          {hasChildren && (
            isExpanded ? (
              <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />
            ) : (
              <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />
            )
          )}
        </button>

        {hasChildren && isExpanded && (
          <div className="ml-2 mt-1 space-y-1">
            {item.children!.map(child => renderMenuItem(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={cn("flex flex-col h-full bg-[#0f1419] overflow-hidden", className)}>
      <div className="p-4 border-b border-slate-700/50 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center flex-shrink-0">
            <span className="text-white font-bold text-lg">G</span>
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-white font-bold truncate">GMS</h1>
            <p className="text-xs text-slate-400 truncate">{user.nickname}</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-1">
        {loadingMenus ? (
          <div className="text-center py-8">
            <div className="loading-premium mx-auto"></div>
            <p className="text-xs text-slate-400 mt-2">메뉴 로딩 중...</p>
          </div>
        ) : (
          menuItems.map(item => renderMenuItem(item))
        )}
      </div>

      <div className="p-3 border-t border-slate-700/50 flex-shrink-0">
        <div className="text-xs text-slate-500 text-center truncate">
          {user.partner_type} · Lv.{user.level}
        </div>
      </div>
    </div>
  );
}
