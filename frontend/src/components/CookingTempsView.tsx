import React, { useState } from 'react';
import { Thermometer, ArrowLeft, Flame, ShieldCheck, Info } from 'lucide-react';

interface DonenessLevel {
  level: string;
  pullTempC?: number;
  targetTempC: number;
  targetTempCMax?: number;
  color: string;
  description: string;
  recommended?: boolean;
}

interface ProteinGuide {
  id: string;
  name: string;
  subtitle: string;
  restingNote: string;
  usdaSafeC: number;
  levels: DonenessLevel[];
}

const PROTEIN_GUIDES: ProteinGuide[] = [
  {
    id: 'beef',
    name: 'Beef',
    subtitle: 'Steaks, Roasts, Burgers & BBQ Brisket',
    restingNote: 'Rest steaks 5–10 minutes and roasts 15–20 minutes; internal temp rises 2–3°C (5°F) during carryover.',
    usdaSafeC: 63,
    levels: [
      {
        level: 'Rare',
        pullTempC: 49,
        targetTempC: 52,
        color: '#ef4444',
        description: 'Cool-to-warm red center, soft and very tender. Best for lean cuts like filet mignon.',
      },
      {
        level: 'Medium Rare',
        pullTempC: 54,
        targetTempC: 57,
        color: '#f97316',
        description: 'Warm red center with rendered fat and maximum juiciness. Ideal for ribeye, strip, and sirloin.',
        recommended: true,
      },
      {
        level: 'Medium',
        pullTempC: 60,
        targetTempC: 63,
        color: '#fb7185',
        description: 'Warm pink center throughout, firmer texture. USDA minimum with a 3-minute rest.',
      },
      {
        level: 'Medium Well',
        pullTempC: 63,
        targetTempC: 66,
        color: '#d97706',
        description: 'Mostly brown center with a slight hint of pink, firm texture.',
      },
      {
        level: 'Well Done',
        pullTempC: 68,
        targetTempC: 71,
        color: '#78716c',
        description: 'No pink remaining; firm and drier unless braised.',
      },
      {
        level: 'Ground Beef / Burgers',
        targetTempC: 71,
        color: '#b45309',
        description: 'USDA safe minimum internal temperature for ground beef.',
      },
      {
        level: 'Brisket / Chuck (BBQ Low & Slow)',
        targetTempC: 93,
        targetTempCMax: 96,
        color: '#991b1b',
        description: 'Cook until probe-tender; collagen melts into gelatin between 93°C and 96°C (200–205°F).',
      },
    ],
  },
  {
    id: 'pork',
    name: 'Pork',
    subtitle: 'Chops, Tenderloin, Loin Roasts, Sausages & Pulled Pork',
    restingNote: 'Rest thick chops and tenderloin 5–10 minutes before slicing to retain juices.',
    usdaSafeC: 63,
    levels: [
      {
        level: 'Medium Rare (Sous Vide / Culinary)',
        pullTempC: 55,
        targetTempC: 57,
        targetTempCMax: 60,
        color: '#fb7185',
        description: 'Blush pink and exceptionally juicy for high-quality pork tenderloin or thick bone-in chops.',
      },
      {
        level: 'Medium (USDA Safe + 3m Rest)',
        pullTempC: 60,
        targetTempC: 63,
        color: '#f97316',
        description: 'Faint hint of pink, tender and juicy. USDA recommended safe temperature for whole cuts.',
        recommended: true,
      },
      {
        level: 'Medium Well',
        pullTempC: 63,
        targetTempC: 66,
        color: '#d97706',
        description: 'Opaque white throughout while still retaining moisture.',
      },
      {
        level: 'Well Done',
        pullTempC: 68,
        targetTempC: 71,
        color: '#78716c',
        description: 'Fully cooked through with firm texture; lean cuts can dry out.',
      },
      {
        level: 'Ground Pork & Sausages',
        targetTempC: 71,
        color: '#b45309',
        description: 'Safe minimum temperature for fresh sausages, meatballs, and ground pork.',
      },
      {
        level: 'Pork Ribs (Baby Back / St. Louis)',
        targetTempC: 88,
        targetTempCMax: 95,
        color: '#dc2626',
        description: 'Tender and pull-off-the-bone when meat cracks slightly on the bend test.',
      },
      {
        level: 'Pork Shoulder / Butt (Pulled Pork)',
        targetTempC: 95,
        targetTempCMax: 98,
        color: '#991b1b',
        description: 'Collagen fully rendered for effortless shredding.',
      },
    ],
  },
  {
    id: 'poultry',
    name: 'Poultry',
    subtitle: 'Chicken & Turkey Breast, Thighs, Whole Bird & Ground',
    restingNote: 'White meat dries out above 74°C (165°F), while dark meat thrives at 79–85°C (175–185°F).',
    usdaSafeC: 74,
    levels: [
      {
        level: 'Breast / White Meat (Sous Vide Pasteurized)',
        targetTempC: 63,
        targetTempCMax: 66,
        color: '#f59e0b',
        description: 'Hold at 63°C (145°F) for 9.8 mins or 66°C (150°F) for 2.8 mins for ultra-juicy pasteurized breast.',
      },
      {
        level: 'Breast / White Meat (Traditional)',
        pullTempC: 71,
        targetTempC: 74,
        color: '#10b981',
        description: 'Pull at 71°C (160°F) and let carryover reach 74°C (165°F) for instant USDA lethality without drying.',
        recommended: true,
      },
      {
        level: 'Dark Meat (Thighs, Drumsticks, Wings)',
        pullTempC: 77,
        targetTempC: 79,
        targetTempCMax: 85,
        color: '#f97316',
        description: 'Higher temperature breaks down connective tissue in thighs and legs for tender, succulent meat.',
        recommended: true,
      },
      {
        level: 'Ground Chicken / Turkey',
        targetTempC: 74,
        color: '#b45309',
        description: 'USDA safe minimum temperature for poultry burgers, meatballs, and sausages.',
      },
    ],
  },
  {
    id: 'lamb',
    name: 'Lamb',
    subtitle: 'Rack of Lamb, Chops, Leg of Lamb, Shoulder & Ground',
    restingNote: 'Rest lamb rack or chops 5–10 minutes and leg of lamb 15–20 minutes under foil.',
    usdaSafeC: 63,
    levels: [
      {
        level: 'Rare',
        pullTempC: 49,
        targetTempC: 52,
        color: '#ef4444',
        description: 'Deep red, warm center; very soft texture.',
      },
      {
        level: 'Medium Rare',
        pullTempC: 54,
        targetTempC: 57,
        color: '#f97316',
        description: 'Warm red-to-pink center. Best for rack of lamb, loin chops, and noisettes.',
        recommended: true,
      },
      {
        level: 'Medium',
        pullTempC: 58,
        targetTempC: 60,
        targetTempCMax: 63,
        color: '#fb7185',
        description: 'Rosy pink throughout. Ideal for roasting a whole leg of lamb.',
      },
      {
        level: 'Medium Well',
        pullTempC: 63,
        targetTempC: 66,
        color: '#d97706',
        description: 'Light pink trace in the center, firmer bite.',
      },
      {
        level: 'Well Done',
        pullTempC: 68,
        targetTempC: 71,
        color: '#78716c',
        description: 'Cooked completely through with no pink.',
      },
      {
        level: 'Ground Lamb / Kofta',
        targetTempC: 71,
        color: '#b45309',
        description: 'Safe minimum temperature for ground lamb burgers and kofta.',
      },
      {
        level: 'Lamb Shoulder (Slow Roasted / Braised)',
        targetTempC: 90,
        targetTempCMax: 93,
        color: '#991b1b',
        description: 'Fork-tender and pullable after slow roasting or braising.',
      },
    ],
  },
  {
    id: 'duck',
    name: 'Duck',
    subtitle: 'Duck Breast (Magret), Confit Legs & Whole Roast Duck',
    restingNote: 'Score duck breast skin, start in a cold pan to render fat, and rest 5–8 minutes skin-side up.',
    usdaSafeC: 74,
    levels: [
      {
        level: 'Rare (Breast)',
        pullTempC: 49,
        targetTempC: 52,
        color: '#ef4444',
        description: 'Deep red center; very soft.',
      },
      {
        level: 'Medium Rare (Breast - Chef Standard)',
        pullTempC: 52,
        targetTempC: 54,
        targetTempCMax: 57,
        color: '#f97316',
        description: 'Rosy red-pink interior with crisp rendered skin. Classic French bistro doneness.',
        recommended: true,
      },
      {
        level: 'Medium (Breast)',
        pullTempC: 58,
        targetTempC: 60,
        targetTempCMax: 63,
        color: '#fb7185',
        description: 'Pink center, firmer texture.',
      },
      {
        level: 'Well Done',
        pullTempC: 68,
        targetTempC: 71,
        targetTempCMax: 74,
        color: '#78716c',
        description: 'No pink remaining; USDA standard poultry temperature.',
      },
      {
        level: 'Duck Legs (Braised / Confit)',
        targetTempC: 82,
        targetTempCMax: 88,
        color: '#991b1b',
        description: 'Cooked slowly until meat pulls cleanly from the bone.',
      },
    ],
  },
  {
    id: 'veal',
    name: 'Veal',
    subtitle: 'Chops, Tenderloin, Cutlets & Osso Buco',
    restingNote: 'Veal is delicate and low in fat; avoid overcooking loin and rib chops.',
    usdaSafeC: 63,
    levels: [
      {
        level: 'Rare',
        pullTempC: 49,
        targetTempC: 52,
        color: '#ef4444',
        description: 'Warm red center, very delicate texture.',
      },
      {
        level: 'Medium Rare',
        pullTempC: 54,
        targetTempC: 57,
        color: '#f97316',
        description: 'Creamy blush-pink center; ideal for thick rib or loin chops.',
        recommended: true,
      },
      {
        level: 'Medium',
        pullTempC: 60,
        targetTempC: 63,
        color: '#fb7185',
        description: 'Delicate pale pink center. USDA recommended temperature with 3-minute rest.',
      },
      {
        level: 'Medium Well',
        pullTempC: 63,
        targetTempC: 66,
        color: '#d97706',
        description: 'Hint of pink, firmer bite.',
      },
      {
        level: 'Well Done',
        pullTempC: 68,
        targetTempC: 71,
        color: '#78716c',
        description: 'Fully opaque.',
      },
      {
        level: 'Veal Shanks (Osso Buco Braised)',
        targetTempC: 90,
        targetTempCMax: 93,
        color: '#991b1b',
        description: 'Slow-braised until fork-tender and rich with gelatin.',
      },
    ],
  },
  {
    id: 'venison',
    name: 'Venison & Game',
    subtitle: 'Backstrap, Tenderloin, Haunch Roast & Game Burgers',
    restingNote: 'Wild game is extremely lean; pull 3°C (5°F) early and baste with butter to keep moist.',
    usdaSafeC: 63,
    levels: [
      {
        level: 'Rare',
        pullTempC: 48,
        targetTempC: 50,
        targetTempCMax: 52,
        color: '#ef4444',
        description: 'Deep red, ultra-tender center for backstrap and tenderloin.',
      },
      {
        level: 'Medium Rare',
        pullTempC: 52,
        targetTempC: 54,
        targetTempCMax: 57,
        color: '#f97316',
        description: 'Warm red center; preserves moisture in lean game cuts.',
        recommended: true,
      },
      {
        level: 'Medium',
        pullTempC: 57,
        targetTempC: 60,
        color: '#fb7185',
        description: 'Pink center; do not exceed for lean loin cuts or meat will dry out.',
      },
      {
        level: 'Well Done',
        targetTempC: 71,
        color: '#78716c',
        description: 'Not recommended for steaks; use slow braising for tough cuts instead.',
      },
      {
        level: 'Ground Venison / Game Sausages',
        targetTempC: 71,
        color: '#b45309',
        description: 'Safe minimum temperature for ground game meats.',
      },
    ],
  },
  {
    id: 'seafood',
    name: 'Fish & Seafood',
    subtitle: 'Salmon, Tuna, White Fish, Shrimp, Scallops & Lobster',
    restingNote: 'Fish continues to cook rapidly off heat; remove just before flaking.',
    usdaSafeC: 63,
    levels: [
      {
        level: 'Rare / Seared (Tuna, Sushi-Grade Salmon)',
        targetTempC: 43,
        targetTempCMax: 49,
        color: '#ef4444',
        description: 'Seared exterior with cool, translucent ruby/coral center.',
      },
      {
        level: 'Medium Rare (Salmon, Trout, Char)',
        pullTempC: 49,
        targetTempC: 52,
        color: '#f97316',
        description: 'Buttery, silky, and moist flakes without white albumin.',
        recommended: true,
      },
      {
        level: 'Medium (Halibut, Cod, Sea Bass)',
        pullTempC: 54,
        targetTempC: 57,
        color: '#fb7185',
        description: 'Opaque and pearly; flakes cleanly with a fork.',
        recommended: true,
      },
      {
        level: 'Shrimp, Scallops & Lobster',
        targetTempC: 57,
        targetTempCMax: 60,
        color: '#f59e0b',
        description: 'Just opaque and tender; overcooking makes shellfish rubbery.',
      },
      {
        level: 'Well Done (USDA Standard)',
        targetTempC: 63,
        color: '#10b981',
        description: 'USDA safe minimum temperature for all finfish.',
      },
    ],
  },
];

const cToF = (c: number): number => Math.round((c * 9) / 5 + 32);

interface CookingTempsViewProps {
  onBack: () => void;
}

export const CookingTempsView: React.FC<CookingTempsViewProps> = ({ onBack }) => {
  const [selectedProteinId, setSelectedProteinId] = useState<string>('beef');
  const [unitDisplay, setUnitDisplay] = useState<'both' | 'c' | 'f'>('both');

  const currentProtein =
    PROTEIN_GUIDES.find((p) => p.id === selectedProteinId) || PROTEIN_GUIDES[0];

  const formatTemp = (c: number, cMax?: number) => {
    const f = cToF(c);
    const fMax = cMax ? cToF(cMax) : undefined;

    if (unitDisplay === 'c') {
      return cMax ? `${c}–${cMax}°C` : `${c}°C`;
    }
    if (unitDisplay === 'f') {
      return fMax ? `${f}–${fMax}°F` : `${f}°F`;
    }
    if (cMax && fMax) {
      return `${c}–${cMax}°C (${f}–${fMax}°F)`;
    }
    return `${c}°C (${f}°F)`;
  };

  return (
    <div id="cooking-temps-page" style={{ maxWidth: 960, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Top Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button onClick={onBack} className="btn btn-secondary btn-sm">
            <ArrowLeft size={16} />
            <span>Back</span>
          </button>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.6rem', margin: 0 }}>
            <Thermometer size={26} color="var(--accent)" />
            <span>Cooking Temperatures</span>
          </h1>
        </div>

        {/* Unit Display Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <button
            type="button"
            onClick={() => setUnitDisplay('both')}
            className={`btn btn-sm ${unitDisplay === 'both' ? 'btn-primary' : 'btn-secondary'}`}
          >
            °C & °F
          </button>
          <button
            type="button"
            onClick={() => setUnitDisplay('c')}
            className={`btn btn-sm ${unitDisplay === 'c' ? 'btn-primary' : 'btn-secondary'}`}
          >
            °C
          </button>
          <button
            type="button"
            onClick={() => setUnitDisplay('f')}
            className={`btn btn-sm ${unitDisplay === 'f' ? 'btn-primary' : 'btn-secondary'}`}
          >
            °F
          </button>
        </div>
      </div>

      {/* Protein Selector Card */}
      <div className="card" style={{ padding: '1.25rem 1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
          <label htmlFor="protein-select" style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
            Choose Protein:
          </label>
          <select
            id="protein-select"
            value={selectedProteinId}
            onChange={(e) => setSelectedProteinId(e.target.value)}
            className="select"
            style={{ maxWidth: 260, padding: '0.45rem 0.75rem', fontSize: '0.9rem' }}
          >
            {PROTEIN_GUIDES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {/* Interactive Protein Pills */}
        <div
          id="protein-selector"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(135px, 1fr))',
            gap: '0.5rem',
          }}
        >
          {PROTEIN_GUIDES.map((protein) => {
            const active = protein.id === selectedProteinId;
            return (
              <button
                key={protein.id}
                type="button"
                data-protein={protein.id}
                onClick={() => setSelectedProteinId(protein.id)}
                className={`btn btn-sm ${active ? 'btn-primary' : 'btn-secondary'}`}
                style={{
                  justifyContent: 'center',
                  padding: '0.6rem 0.75rem',
                  fontWeight: active ? 700 : 600,
                }}
              >
                {protein.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected Protein Details & Doneness Guide */}
      <div className="card" style={{ padding: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem', borderBottom: '1px solid var(--border)', paddingBottom: '1rem' }}>
          <div>
            <h2 id="selected-protein-title" style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
              {currentProtein.name} Doneness Temperatures
            </h2>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
              {currentProtein.subtitle}
            </p>
          </div>
          <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}>
            <ShieldCheck size={15} />
            <span>USDA Safe: {formatTemp(currentProtein.usdaSafeC)}</span>
          </span>
        </div>

        {/* Resting Info Banner */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            padding: '0.75rem 1rem',
            background: 'var(--bg-input)',
            borderRadius: 'var(--radius-md)',
            marginBottom: '1.25rem',
            fontSize: '0.875rem',
            color: 'var(--text-secondary)',
          }}
        >
          <Info size={16} color="var(--accent)" style={{ flexShrink: 0 }} />
          <span>{currentProtein.restingNote}</span>
        </div>

        {/* Doneness Levels List */}
        <div id="doneness-levels-list" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {currentProtein.levels.map((item) => (
            <div
              key={item.level}
              className="doneness-row"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '1rem',
                padding: '1rem 1.25rem',
                background: 'var(--bg-secondary)',
                border: item.recommended ? '1px solid var(--accent)' : '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.85rem', flex: '1 1 280px' }}>
                <span
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    background: item.color,
                    marginTop: '0.3rem',
                    flexShrink: 0,
                    boxShadow: `0 0 8px ${item.color}`,
                  }}
                />
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-primary)' }}>
                      {item.level}
                    </span>
                    {item.recommended && (
                      <span className="badge badge-accent" style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem' }}>
                        Chef Recommended
                      </span>
                    )}
                  </div>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                    {item.description}
                  </p>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
                {item.pullTempC !== undefined && (
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ display: 'block', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)' }}>
                      Pull From Heat
                    </span>
                    <span style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-secondary)' }}>
                      {formatTemp(item.pullTempC)}
                    </span>
                  </div>
                )}
                <div style={{ textAlign: 'right', minWidth: 130 }}>
                  <span style={{ display: 'block', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)' }}>
                    Target Internal
                  </span>
                  <span style={{ fontWeight: 800, fontSize: '1.15rem', color: 'var(--accent)' }}>
                    {formatTemp(item.targetTempC, item.targetTempCMax)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* USDA Log 7 Lethality Reference Card */}
      <div className="card" style={{ padding: '1.5rem' }}>
        <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <Flame size={18} color="var(--accent)" />
          <span>USDA 7-Log10 Lethality Hold Times (Poultry & Sous Vide)</span>
        </h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
          Pasteurization depends on both temperature and time. Holding poultry at a lower temperature for the specified duration achieves the same bacterial reduction as 74°C (165°F) instantaneously.
        </p>
        <table style={{ width: '100%', fontSize: '0.875rem', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border)', textAlign: 'left', color: 'var(--text-muted)' }}>
              <th style={{ padding: '0.5rem' }}>Internal Temperature</th>
              <th style={{ padding: '0.5rem' }}>Required Hold Time</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: '1px solid var(--border)' }}><td style={{ padding: '0.5rem', fontWeight: 600 }}>{formatTemp(60)}</td><td style={{ padding: '0.5rem' }}>35 minutes</td></tr>
            <tr style={{ borderBottom: '1px solid var(--border)' }}><td style={{ padding: '0.5rem', fontWeight: 600 }}>{formatTemp(63)}</td><td style={{ padding: '0.5rem' }}>9.8 minutes</td></tr>
            <tr style={{ borderBottom: '1px solid var(--border)' }}><td style={{ padding: '0.5rem', fontWeight: 600 }}>{formatTemp(66)}</td><td style={{ padding: '0.5rem' }}>2.8 minutes</td></tr>
            <tr style={{ borderBottom: '1px solid var(--border)' }}><td style={{ padding: '0.5rem', fontWeight: 600 }}>{formatTemp(68)}</td><td style={{ padding: '0.5rem' }}>49 seconds</td></tr>
            <tr style={{ borderBottom: '1px solid var(--border)' }}><td style={{ padding: '0.5rem', fontWeight: 600 }}>{formatTemp(71)}</td><td style={{ padding: '0.5rem' }}>14 seconds</td></tr>
            <tr><td style={{ padding: '0.5rem', fontWeight: 600 }}>{formatTemp(74)}</td><td style={{ padding: '0.5rem', color: 'var(--success)', fontWeight: 700 }}>Instantaneous</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};

