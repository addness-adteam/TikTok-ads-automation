'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { format } from 'date-fns';

interface ChartData {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
}

interface PerformanceChartProps {
  data: ChartData[];
  metric: 'spend' | 'impressions' | 'clicks' | 'conversions';
}

const metricConfig = {
  spend: {
    label: '広告費 ($)',
    color: '#3b82f6',
    format: (value: number) => `$${value.toLocaleString()}`,
  },
  impressions: {
    label: 'インプレッション',
    color: '#10b981',
    format: (value: number) => value.toLocaleString(),
  },
  clicks: {
    label: 'クリック数',
    color: '#f59e0b',
    format: (value: number) => value.toLocaleString(),
  },
  conversions: {
    label: 'コンバージョン数',
    color: '#ef4444',
    format: (value: number) => value.toLocaleString(),
  },
};

export function PerformanceChart({ data, metric }: PerformanceChartProps) {
  const config = metricConfig[metric];

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">
        {config.label}の推移
      </h3>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="date"
            tickFormatter={(value) => format(new Date(value), 'MM/dd')}
            stroke="#6b7280"
            style={{ fontSize: '12px' }}
          />
          <YAxis
            tickFormatter={config.format}
            stroke="#6b7280"
            style={{ fontSize: '12px' }}
          />
          <Tooltip
            formatter={config.format}
            labelFormatter={(value) => format(new Date(value), 'yyyy年MM月dd日')}
            contentStyle={{
              backgroundColor: 'white',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              padding: '8px 12px',
            }}
          />
          <Legend />
          <Line
            type="monotone"
            dataKey={metric}
            stroke={config.color}
            strokeWidth={2}
            dot={{ fill: config.color, r: 4 }}
            activeDot={{ r: 6 }}
            name={config.label}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
