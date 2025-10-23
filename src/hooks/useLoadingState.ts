import { useState, useCallback } from 'react';

export function useLoadingState(initialLoading = false) {
  const [isLoading, setIsLoading] = useState(initialLoading);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async <T>(
    asyncFunction: () => Promise<T>,
    options: {
      onSuccess?: (result: T) => void;
      onError?: (error: Error) => void;
      timeout?: number;
    } = {}
  ): Promise<T | null> => {
    const { onSuccess, onError, timeout = 10000 } = options;
    
    setIsLoading(true);
    setError(null);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('작업 시간이 초과되었습니다.')), timeout);
    });

    try {
      const result = await Promise.race([asyncFunction(), timeoutPromise]);
      onSuccess?.(result);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('알 수 없는 오류가 발생했습니다.');
      setError(error.message);
      onError?.(error);
      console.error('useLoadingState error:', error);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setIsLoading(false);
    setError(null);
  }, []);

  return {
    isLoading,
    error,
    execute,
    reset,
  };
}