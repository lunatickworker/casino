// 상세보기 버튼을 추가할 부분
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDetailUser(row);
                setShowDetailModal(true);
              }}
              title="상세 분석"
            >
              <Eye className="h-4 w-4" />
            </Button>