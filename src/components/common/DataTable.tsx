import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { LoadingSpinner } from "./LoadingSpinner";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { cn } from "../../lib/utils";

export interface Column<T> {
  key?: keyof T | string;
  accessor?: keyof T | string;
  title?: string;
  header?: string;
  render?: (value: any, row: T, index: number) => React.ReactNode;
  cell?: (row: T) => React.ReactNode;
  sortable?: boolean;
  width?: string;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  pagination?: boolean;
  searchable?: boolean;
  enableSearch?: boolean; // 검색 기능 활성화/비활성화
  searchPlaceholder?: string;
  pageSize?: number;
  onRowClick?: (row: T, index: number) => void;
  className?: string;
  emptyMessage?: string;
  rowKey?: string; // 고유 키 필드명
}

export function DataTable<T extends Record<string, any>>({
  columns,
  data,
  loading = false,
  pagination = true,
  searchable = true,
  enableSearch = true, // 기본값 true (하위 호환성)
  searchPlaceholder = "검색...",
  pageSize = 10,
  onRowClick,
  className,
  emptyMessage = "데이터가 없습니다.",
  rowKey = 'id',
}: DataTableProps<T>) {
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortConfig, setSortConfig] = useState<{
    key: string;
    direction: "asc" | "desc";
  } | null>(null);

  // 검색 필터링
  const filteredData = searchTerm
    ? data.filter((row) =>
        Object.values(row).some((value) =>
          String(value).toLowerCase().includes(searchTerm.toLowerCase())
        )
      )
    : data;

  // 정렬
  const sortedData = sortConfig
    ? [...filteredData].sort((a, b) => {
        const aValue = a[sortConfig.key];
        const bValue = b[sortConfig.key];
        
        if (aValue < bValue) {
          return sortConfig.direction === "asc" ? -1 : 1;
        }
        if (aValue > bValue) {
          return sortConfig.direction === "asc" ? 1 : -1;
        }
        return 0;
      })
    : filteredData;

  // 페이지네이션
  const totalPages = Math.ceil(sortedData.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedData = pagination
    ? sortedData.slice(startIndex, startIndex + pageSize)
    : sortedData;

  const handleSort = (key: string) => {
    const column = columns.find(col => (col.key || col.accessor) === key);
    if (!column?.sortable) return;
    
    setSortConfig(current => {
      if (current?.key === key) {
        return {
          key,
          direction: current.direction === "asc" ? "desc" : "asc",
        };
      }
      return { key, direction: "asc" };
    });
  };

  const getCellValue = (row: T, column: Column<T>) => {
    const key = (column.key || column.accessor) as keyof T;
    return row[key];
  };

  if (loading) {
    return (
      <div className="border border-slate-700/50 rounded-lg bg-slate-800/30">
        <LoadingSpinner size="lg" text="데이터를 불러오는 중..." className="py-8" />
      </div>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      {/* 검색 - enableSearch prop으로 제어 */}
      {searchable && enableSearch && (
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-slate-400" />
          <Input
            placeholder={searchPlaceholder}
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1);
            }}
            className="max-w-sm input-premium"
          />
        </div>
      )}

      {/* 테이블 */}
      <div className="table-premium rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-slate-700/50 hover:bg-slate-700/30">
              {columns.map((column, index) => {
                const columnKey = (column.key || column.accessor) as string;
                const columnTitle = column.title || column.header || '';
                
                return (
                  <TableHead
                    key={index}
                    className={cn(
                      "whitespace-nowrap text-slate-300 font-semibold",
                      column.sortable && "cursor-pointer hover:bg-slate-700/50",
                      column.className
                    )}
                    style={{ width: column.width }}
                    onClick={() => column.sortable && handleSort(columnKey)}
                  >
                    <div className="flex items-center gap-1">
                      {columnTitle}
                      {column.sortable && sortConfig?.key === columnKey && sortConfig.direction && (
                        <span className="text-xs text-blue-400">
                          {sortConfig.direction === "asc" ? "↑" : "↓"}
                        </span>
                      )}
                    </div>
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedData.length === 0 ? (
              <TableRow className="border-slate-700/50">
                <TableCell
                  colSpan={columns.length}
                  className="text-center py-8 text-slate-400"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              paginatedData.map((row, rowIndex) => {
                // 고유한 키 생성 - rowKey prop이 지정되면 사용, 없으면 자동 생성
                const uniqueKey = row[rowKey] || row.id || row.external_txid || row.username || `row-${currentPage}-${rowIndex}`;
                
                return (
                  <TableRow
                    key={uniqueKey}
                    className={cn(
                      "border-slate-700/50 text-slate-200",
                      onRowClick && "cursor-pointer hover:bg-slate-700/30"
                    )}
                    onClick={() => onRowClick?.(row, startIndex + rowIndex)}
                  >
                    {columns.map((column, colIndex) => (
                      <TableCell key={`${uniqueKey}-col-${colIndex}`} className={column.className}>
                        {column.render
                          ? column.render(getCellValue(row, column), row, startIndex + rowIndex)
                          : column.cell
                          ? column.cell(row)
                          : String(getCellValue(row, column) || "")}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* 페이지네이션 */}
      {pagination && totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-slate-400">
            총 {sortedData.length}개 중 {startIndex + 1}-{Math.min(startIndex + pageSize, sortedData.length)}개 표시
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className="border-slate-700 text-slate-300 hover:bg-slate-700/50"
            >
              <ChevronLeft className="h-4 w-4" />
              이전
            </Button>
            <span className="text-sm px-2 text-slate-300">
              {currentPage} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
              className="border-slate-700 text-slate-300 hover:bg-slate-700/50"
            >
              다음
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
