import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Badge } from "../ui/badge";
import { toast } from "sonner@2.0.3";
import { Copy, CheckCircle, AlertCircle } from "lucide-react";
import { generateSignature } from "../../lib/investApi";

export function BettingSyncDebugger() {
  const [opcode, setOpcode] = useState('eeo2211');
  const [secretKey, setSecretKey] = useState('CpxIc4mzOSfQaKNLzAJoSoUa8TmVuskj');
  const [year, setYear] = useState('2025');
  const [month, setMonth] = useState('1');
  const [index, setIndex] = useState('0');
  const [signature, setSignature] = useState('');
  const [testResult, setTestResult] = useState<any>(null);
  const [testing, setTesting] = useState(false);

  // Signature 생성 테스트
  const generateTestSignature = () => {
    try {
      const sig = generateSignature([opcode, year, month, index], secretKey);
      setSignature(sig);
      
      console.log('🔐 Signature 생성 테스트:', {
        opcode,
        year,
        month,
        index,
        secretKey: secretKey.substring(0, 4) + '...' + secretKey.slice(-4),
        combined: `${opcode}${year}${month}${index}${secretKey}`,
        signature: sig
      });
      
      toast.success('Signature 생성 완료!');
    } catch (error) {
      console.error('Signature 생성 오류:', error);
      toast.error('Signature 생성 실패!');
    }
  };

  // API 호출 테스트
  const testAPICall = async () => {
    if (!signature) {
      toast.error('먼저 Signature를 생성하세요.');
      return;
    }

    try {
      setTesting(true);
      setTestResult(null);

      console.log('🧪 API 테스트 시작...');

      const response = await fetch('https://vi8282.com/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'https://api.invest-ho.com/api/game/historyindex',
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          body: {
            opcode,
            year,
            month,
            index: parseInt(index),
            limit: 10, // 테스트용 10개만
            signature
          }
        })
      });

      console.log('📡 응답 상태:', response.status);

      const result = await response.json();
      
      console.log('📊 API 응답:', typeof result);
      
      // DATA 배열 확인
      if (result && result.DATA && Array.isArray(result.DATA)) {
        console.log(`📦 DATA: ${result.DATA.length}개 레코드`);
        if (result.DATA.length > 0) {
          console.log('📋 첫 번째 레코드:', result.DATA[0]);
        }
      }

      setTestResult({
        success: response.ok,
        status: response.status,
        data: result
      });

      if (response.ok) {
        toast.success('API 호출 성공! 콘솔에서 상세 데이터를 확인하세요.');
      } else {
        toast.error(`API 호출 실패: ${response.status}`);
      }
    } catch (error) {
      console.error('API 테스트 오류:', error);
      setTestResult({
        success: false,
        error: error instanceof Error ? error.message : '알 수 없는 오류'
      });
      toast.error('API 테스트 실패!');
    } finally {
      setTesting(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('클립보드에 복사되었습니다.');
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>베팅 동기화 디버거</CardTitle>
          <p className="text-sm text-muted-foreground">
            MD5 Signature 생성 및 API 호출을 테스트합니다.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 입력 필드 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>OPCODE</Label>
              <Input
                value={opcode}
                onChange={(e) => setOpcode(e.target.value)}
                placeholder="eeo2211"
              />
            </div>

            <div className="space-y-2">
              <Label>Secret Key</Label>
              <Input
                type="password"
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                placeholder="Secret Key"
              />
            </div>

            <div className="space-y-2">
              <Label>Year</Label>
              <Input
                value={year}
                onChange={(e) => setYear(e.target.value)}
                placeholder="2025"
              />
            </div>

            <div className="space-y-2">
              <Label>Month</Label>
              <Input
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                placeholder="1"
              />
            </div>

            <div className="space-y-2">
              <Label>Index</Label>
              <Input
                value={index}
                onChange={(e) => setIndex(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          {/* Signature 생성 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>생성된 Signature (MD5)</Label>
              <Button onClick={generateTestSignature} size="sm">
                Signature 생성
              </Button>
            </div>
            {signature && (
              <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                <code className="flex-1 text-sm font-mono">{signature}</code>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => copyToClipboard(signature)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          {/* API 테스트 */}
          <div className="space-y-2">
            <Button
              onClick={testAPICall}
              disabled={testing || !signature}
              className="w-full"
            >
              {testing ? 'API 테스트 중...' : 'API 호출 테스트'}
            </Button>
          </div>

          {/* 테스트 결과 */}
          {testResult && (
            <div className="space-y-2">
              <Label>테스트 결과</Label>
              <div className={`p-4 rounded-lg border ${testResult.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                <div className="flex items-start gap-2 mb-2">
                  {testResult.success ? (
                    <CheckCircle className="h-5 w-5 text-green-600" />
                  ) : (
                    <AlertCircle className="h-5 w-5 text-red-600" />
                  )}
                  <div className="flex-1">
                    <p className={`font-medium ${testResult.success ? 'text-green-800' : 'text-red-800'}`}>
                      {testResult.success ? 'API 호출 성공!' : 'API 호출 실패'}
                    </p>
                    {testResult.status && (
                      <Badge variant="outline" className="mt-1">
                        HTTP {testResult.status}
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="mt-3 p-3 bg-white rounded border overflow-auto max-h-96">
                  <pre className="text-xs font-mono">
                    {JSON.stringify(testResult.data || testResult.error, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          )}

          {/* 디버그 정보 */}
          <div className="space-y-2 p-4 bg-muted rounded-lg">
            <p className="text-sm font-medium">디버그 정보</p>
            <div className="text-xs font-mono space-y-1 text-muted-foreground">
              <p>조합 문자열: {opcode}{year}{month}{index}{secretKey.substring(0, 4)}...</p>
              <p>Proxy URL: https://vi8282.com/proxy</p>
              <p>Target API: https://api.invest-ho.com/api/game/historyindex</p>
              <p>Method: GET (via POST to proxy)</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default BettingSyncDebugger;
