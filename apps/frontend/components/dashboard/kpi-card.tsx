import { LucideIcon } from 'lucide-react';

interface KpiCardProps {
  title: string;
  value: string | number;
  change?: number;
  icon: LucideIcon;
  format?: 'number' | 'currency' | 'percentage';
}

export function KpiCard({ title, value, change, icon: Icon, format = 'number' }: KpiCardProps) {
  const formattedValue = () => {
    if (typeof value === 'number') {
      switch (format) {
        case 'currency':
          return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        case 'percentage':
          return `${value.toFixed(2)}%`;
        default:
          return value.toLocaleString('en-US');
      }
    }
    return value;
  };

  const changeColor = change && change > 0 ? 'text-green-600' : change && change < 0 ? 'text-red-600' : 'text-gray-600';
  const changePrefix = change && change > 0 ? '+' : '';

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-600 mb-1">{title}</p>
          <p className="text-2xl font-bold text-gray-900">{formattedValue()}</p>
          {change !== undefined && (
            <p className={`text-sm font-medium mt-2 ${changeColor}`}>
              {changePrefix}{change.toFixed(1)}% vs 前日
            </p>
          )}
        </div>
        <div className="ml-4 p-3 bg-blue-50 rounded-lg">
          <Icon className="w-6 h-6 text-blue-600" />
        </div>
      </div>
    </div>
  );
}
