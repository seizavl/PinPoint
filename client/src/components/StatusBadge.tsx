import { SendStatus } from '../types';

interface Props {
  status: SendStatus;
}

const config: Record<SendStatus, { label: string; className: string }> = {
  idle: { label: '待機中', className: 'bg-slate-700 text-slate-300' },
  sending: { label: '送信中...', className: 'bg-yellow-600 text-yellow-100 animate-pulse' },
  success: { label: '送信成功', className: 'bg-green-600 text-green-100' },
  error: { label: '送信失敗', className: 'bg-red-600 text-red-100' },
  permission_denied: { label: '権限拒否', className: 'bg-orange-600 text-orange-100' },
};

export function StatusBadge({ status }: Props) {
  const { label, className } = config[status];
  return (
    <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${className}`}>
      {label}
    </span>
  );
}
