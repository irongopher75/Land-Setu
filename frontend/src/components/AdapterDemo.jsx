import React, { useState, useEffect } from 'react';
import { Play, Cpu, CheckCircle2, Layers } from 'lucide-react';
import { getRawSamples, previewAdapter } from '../api';

const ALL_INDIAN_STATES = [
  { key: 'TamilNadu', label: 'Tamil Nadu (TN_RoR_v3 Config)' },
  { key: 'Chandigarh', label: 'Chandigarh (CHD_Jamabandi_v2 Config)' },
  { key: 'Maharashtra', label: 'Maharashtra (MH_712_v1 Config)' },
  { key: 'Karnataka', label: 'Karnataka (KA_Bhoomi_v2 Config)' },
  { key: 'Delhi', label: 'Delhi (DL_Bhulekh_v1 Config)' },
  { key: 'Telangana', label: 'Telangana (TG_Dharani_v2 Config)' },
  { key: 'Kerala', label: 'Kerala (KL_REIS_v1 Config)' },
  { key: 'WestBengal', label: 'West Bengal (WB_Banglarbhumi_v3 Config)' },
  { key: 'Gujarat', label: 'Gujarat (GJ_AnyRoR_v2 Config)' },
  { key: 'Rajasthan', label: 'Rajasthan (RJ_Apnakhata_v1 Config)' },
  { key: 'UttarPradesh', label: 'Uttar Pradesh (UP_Bhulekh_v3 Config)' },
  { key: 'Punjab', label: 'Punjab (PB_Jamabandi_v1 Config)' },
  { key: 'MadhyaPradesh', label: 'Madhya Pradesh (MP_Bhulekh_v2 Config)' },
  { key: 'AndhraPradesh', label: 'Andhra Pradesh (AP_Meebhoomi_v2 Config)' },
  { key: 'ArunachalPradesh', label: 'Arunachal Pradesh (AR_LandRecord_v1 Config)' },
  { key: 'Assam', label: 'Assam (AS_Dharitree_v2 Config)' },
  { key: 'Bihar', label: 'Bihar (BR_Biharbhumi_v3 Config)' },
  { key: 'Chhattisgarh', label: 'Chhattisgarh (CG_Bhuiyan_v2 Config)' },
  { key: 'Goa', label: 'Goa (GA_FormI_IV_v1 Config)' },
  { key: 'Haryana', label: 'Haryana (HR_Jamabandi_v2 Config)' },
  { key: 'HimachalPradesh', label: 'Himachal Pradesh (HP_Himbhoomi_v1 Config)' },
  { key: 'Jharkhand', label: 'Jharkhand (JH_Jharbhoomi_v2 Config)' },
  { key: 'Manipur', label: 'Manipur (MN_LouchaPathap_v1 Config)' },
  { key: 'Meghalaya', label: 'Meghalaya (ML_Revenue_v1 Config)' },
  { key: 'Mizoram', label: 'Mizoram (MZ_NLUP_v1 Config)' },
  { key: 'Nagaland', label: 'Nagaland (NL_NLDB_v1 Config)' },
  { key: 'Odisha', label: 'Odisha (OR_Bhulekh_v2 Config)' },
  { key: 'Sikkim', label: 'Sikkim (SK_LandRevenue_v1 Config)' },
  { key: 'Tripura', label: 'Tripura (TR_Jami_v2 Config)' },
  { key: 'Uttarakhand', label: 'Uttarakhand (UK_Devbhoomi_v2 Config)' },
  { key: 'AndamanNicobar', label: 'Andaman & Nicobar Islands (AN_eTerritory_v1 Config)' },
  { key: 'DadraNagarHaveliDamanDiu', label: 'Dadra & Nagar Haveli and Daman & Diu (DN_LandRecord_v1 Config)' },
  { key: 'JammuKashmir', label: 'Jammu & Kashmir (JK_AapkiZameen_v1 Config)' },
  { key: 'Ladakh', label: 'Ladakh (LA_Revenue_v1 Config)' },
  { key: 'Lakshadweep', label: 'Lakshadweep (LD_LandRegister_v1 Config)' },
  { key: 'Puducherry', label: 'Puducherry (PY_Nilam_v1 Config)' }
];

const getRecordsForState = (st, sampleData) => {
  if (sampleData && sampleData[st] && sampleData[st].length > 0) {
    return sampleData[st];
  }
  const prefix = st.slice(0, 3).toUpperCase();
  return [{
    ulpin: `${prefix}-MOCK-RECORD-0042`,
    pattadar_peyar: `Registered Owner (${st})`,
    khatha_num: `KH-${prefix}-1187`,
    extent_hectares: "0.0452",
    patta_type: "record_of_rights",
    transaction_ref: `REG-2022-${prefix}-882`,
    transaction_date: "2021-08-14",
    land_use_code: "residential",
    fsi_permitted: "1.5",
    permit_ref: `BP-2023-${prefix}-441`,
    permit_status: "approved",
    approved_fsi: "1.5",
    tax_annual_value: "45000",
    tax_last_updated: "2022-01-01",
    encumbrance_flag: "false"
  }];
};

export default function AdapterDemo() {
  const [samples, setSamples] = useState({});
  const [state, setState] = useState('TamilNadu');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [rawRecord, setRawRecord] = useState(null);
  const [canonicalOutput, setCanonicalOutput] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchSamples();
  }, []);

  useEffect(() => {
    const recs = getRecordsForState(state, samples);
    if (recs && recs.length > 0) {
      setSelectedIndex(0);
      const initialRecord = recs[0];
      setRawRecord(initialRecord);
      runAdapterPreview(state, initialRecord);
    }
  }, [state, samples]);

  const fetchSamples = async () => {
    try {
      const data = await getRawSamples();
      setSamples(data);
    } catch (err) {
      console.error('Failed to load raw sample records:', err);
    }
  };

  const handleRecordChange = (index) => {
    setSelectedIndex(index);
    const recs = getRecordsForState(state, samples);
    const rec = recs[index];
    setRawRecord(rec);
    runAdapterPreview(state, rec);
  };

  const runAdapterPreview = async (currentState, record) => {
    if (!record) return;
    setLoading(true);
    try {
      const res = await previewAdapter(currentState, record);
      setCanonicalOutput(res.canonical);
    } catch (err) {
      console.error('Adapter preview failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const currentRecords = getRecordsForState(state, samples);

  return (
    <div className="adapter-demo-container">
      <div>
        <h2 className="title-row"><Cpu aria-hidden="true" /> Schema adapter</h2>
        <p className="subtle">Each state publishes records in its own format. A declarative YAML config maps every format into one canonical schema. No code change per state.</p>
      </div>

      <div className="toolbar">
        <label>Target state
          <select value={state} onChange={(e) => setState(e.target.value)}>
            {ALL_INDIAN_STATES.map((st) => (
              <option key={st.key} value={st.key}>{st.label}</option>
            ))}
          </select>
        </label>

        <label>Raw record
          <select value={selectedIndex} onChange={(e) => handleRecordChange(Number(e.target.value))}>
            {currentRecords.map((r, i) => {
              const name = r.pattadar_peyar || r.owner_full_name || r.khatedar_nama || r.hissadar_hesaru || r.khatauni_owner || r.pattadar_namam || r.udama_peru || r.raiyat_naam || r.malik_naam || r.bhoomi_swami || 'Record';
              return (
                <option key={i} value={i}>
                  Record {i + 1}: {r.ulpin || 'SAMPLE-001'} ({name})
                </option>
              );
            })}
          </select>
        </label>

        <button className="btn btn--primary btn--auto" onClick={() => runAdapterPreview(state, rawRecord)}>
          <Play size={16} aria-hidden="true" /> Run adapter
        </button>
      </div>

      <div className="sandbox-grid">
        <div className="stack--tight stack">
          <div className="pane-title"><Layers size={16} aria-hidden="true" /> Raw record from {state}</div>
          <pre className="code-box">{rawRecord ? JSON.stringify(rawRecord, null, 2) : 'Select a record.'}</pre>
        </div>

        <div className="stack--tight stack">
          <div className="pane-title"><CheckCircle2 size={16} aria-hidden="true" /> Canonical output</div>
          <pre className="code-box">{loading ? 'Running adapter.' : canonicalOutput ? JSON.stringify(canonicalOutput, null, 2) : 'No output.'}</pre>
        </div>
      </div>
    </div>
  );
}
