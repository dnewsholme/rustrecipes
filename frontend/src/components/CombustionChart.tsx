import React, { useEffect, useState } from 'react';
import Papa from 'papaparse';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { Activity } from 'lucide-react';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

interface CombustionChartProps {
  csvUrl: string;
  tempUnit: 'c' | 'f';
}

export const CombustionChart: React.FC<CombustionChartProps> = ({ csvUrl, tempUnit }) => {
  const [chartData, setChartData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;
    setLoading(true);
    setError(null);

    const fullUrl = csvUrl.startsWith('http') || csvUrl.startsWith('/') ? csvUrl : `/${csvUrl}`;

    fetch(fullUrl)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load CSV file');
        return res.text();
      })
      .then((csvText) => {
        if (isCancelled) return;

        // Skip metadata header if present
        const lines = csvText.split('\n');
        const headerIdx = lines.findIndex((l) => l.startsWith('Timestamp'));
        if (headerIdx === -1) {
          throw new Error('Invalid Combustion CSV format: Timestamp column not found');
        }

        const dataText = lines.slice(headerIdx).join('\n');
        const parsed = Papa.parse<any>(dataText, {
          header: true,
          dynamicTyping: true,
          skipEmptyLines: true,
        });

        const rows = parsed.data;
        if (!rows || rows.length === 0) {
          throw new Error('No temperature data points found in CSV');
        }

        const labels = rows.map((r) => ((parseFloat(r['Timestamp']) || 0) / 60).toFixed(1)); // minutes

        const convertTemp = (val: number | null | undefined) => {
          if (val === undefined || val === null || isNaN(val)) return null;
          if (tempUnit === 'f') {
            return (val * 9) / 5 + 32;
          }
          return val;
        };

        const coreTemps = rows.map((r) => convertTemp(r['VirtualCoreTemperature']));
        const surfaceTemps = rows.map((r) => convertTemp(r['VirtualSurfaceTemperature']));
        const ambientTemps = rows.map((r) => convertTemp(r['VirtualAmbientTemperature']));

        setChartData({
          labels,
          datasets: [
            {
              label: `Core (${tempUnit.toUpperCase()}°)`,
              data: coreTemps,
              borderColor: '#ef4444',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              tension: 0.2,
              pointRadius: 0,
              borderWidth: 2,
            },
            {
              label: `Surface (${tempUnit.toUpperCase()}°)`,
              data: surfaceTemps,
              borderColor: '#f59e0b',
              backgroundColor: 'rgba(245, 158, 11, 0.1)',
              tension: 0.2,
              pointRadius: 0,
              borderWidth: 2,
            },
            {
              label: `Ambient (${tempUnit.toUpperCase()}°)`,
              data: ambientTemps,
              borderColor: '#3b82f6',
              backgroundColor: 'rgba(59, 130, 246, 0.1)',
              tension: 0.2,
              pointRadius: 0,
              borderWidth: 2,
            },
          ],
        });
        setLoading(false);
      })
      .catch((err) => {
        if (!isCancelled) {
          setError(err.message || 'Error parsing combustion data');
          setLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [csvUrl, tempUnit]);

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
        Loading combustion thermometer data...
      </div>
    );
  }

  if (error || !chartData) {
    return (
      <div style={{ padding: '1.5rem', background: 'rgba(239, 68, 68, 0.1)', borderRadius: 'var(--radius-md)', color: 'var(--danger)' }}>
        {error || 'Unable to render temperature chart'}
      </div>
    );
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index' as const,
      intersect: false,
    },
    scales: {
      x: {
        title: {
          display: true,
          text: 'Elapsed Time (minutes)',
          color: '#94a3b8',
        },
        grid: {
          color: 'rgba(148, 163, 184, 0.1)',
        },
        ticks: { color: '#94a3b8' },
      },
      y: {
        title: {
          display: true,
          text: `Temperature (°${tempUnit.toUpperCase()})`,
          color: '#94a3b8',
        },
        grid: {
          color: 'rgba(148, 163, 184, 0.1)',
        },
        ticks: { color: '#94a3b8' },
      },
    },
    plugins: {
      legend: {
        position: 'top' as const,
        labels: { color: '#f8fafc' },
      },
    },
  };

  return (
    <div style={{ width: '100%', height: 350, position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.75rem', color: 'var(--accent)', fontWeight: 600 }}>
        <Activity size={18} />
        <span>Combustion Predictive Thermometer Profile</span>
      </div>
      <div style={{ width: '100%', height: 300 }}>
        <Line data={chartData} options={options} />
      </div>
    </div>
  );
};
