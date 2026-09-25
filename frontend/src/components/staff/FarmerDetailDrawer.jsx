import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  X,
  User,
  Phone,
  MapPin,
  Calendar,
  Clock,
  Building2,
  CheckCircle2,
  ArrowRight,
  ShieldCheck,
  CreditCard,
  Scale,
  Briefcase,
  FileCheck,
  FileText,
  IndianRupee,
  Sparkles
} from 'lucide-react';
import Button from '../common/Button';
import Badge from '../common/Badge';
import { getLocalizedCrop } from '../../utils/formatters';

export const FarmerDetailDrawer = ({
  farmerEntry,
  isOpen,
  onClose,
  onOpenInWorkspace,
  onAdvanceState,
  isProcessing = false,
  onViewReceipt
}) => {
  const { t } = useTranslation();
  const [activeView, setActiveView] = useState('DOSSIER'); // 'DOSSIER' | 'WORKSPACE'
  const savedStylesRef = useRef(null);
  const savedScrollYRef = useRef(0);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Viewport-anchored scroll lock & exact scroll position preservation
  useEffect(() => {
    if (!isOpen) return;

    // 1. Capture current scroll position and original body styles
    const scrollY = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
    savedScrollYRef.current = scrollY;

    const originalStyles = {
      position: document.body.style.position,
      top: document.body.style.top,
      left: document.body.style.left,
      width: document.body.style.width,
      overflow: document.body.style.overflow
    };
    savedStylesRef.current = originalStyles;

    // 2. Lock body scroll at current scrollY without page jumping
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = '0';
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';

    // 3. Escape key listener
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (onCloseRef.current) onCloseRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    // 4. Cleanup when closing or unmounting
    return () => {
      window.removeEventListener('keydown', handleKeyDown);

      const saved = savedStylesRef.current;
      const targetScrollY = savedScrollYRef.current;

      document.body.style.position = saved?.position || '';
      document.body.style.top = saved?.top || '';
      document.body.style.left = saved?.left || '';
      document.body.style.width = saved?.width || '';
      document.body.style.overflow = saved?.overflow || '';

      savedStylesRef.current = null;

      // Restore exact previous background scroll position
      window.scrollTo(0, targetScrollY);
    };
  }, [isOpen]);

  // Reset to DOSSIER view when new farmer is selected
  useEffect(() => {
    if (isOpen) {
      setActiveView('DOSSIER');
    }
  }, [farmerEntry?._id, farmerEntry?.id, isOpen]);

  if (!isOpen || !farmerEntry) return null;

  const STAGES = [
    { key: 'BOOKED', label: t('lifecycle.booked', 'Slot Booked'), desc: t('staff.journey_booked_desc', 'Scheduled online via Farmer Portal') },
    { key: 'WAITING', label: t('lifecycle.waiting', 'Waiting in Queue'), desc: t('staff.journey_waiting_desc', 'Farmer physically in queue line') },
    { key: 'CALLED', label: t('lifecycle.called', 'Called to Counter'), desc: t('staff.journey_called_desc', 'Token called to operational counter station') },
    { key: 'ARRIVED', label: t('lifecycle.arrived', 'Arrived at Station'), desc: t('staff.journey_arrived_desc', 'Farmer present at counter') },
    { key: 'VERIFICATION', label: t('lifecycle.verification', 'Identity & Crop Verified'), desc: t('staff.journey_verify_desc', 'Farmer ID & token matched against roster') },
    { key: 'QUALITY_CHECK', label: t('lifecycle.quality_check', 'Quality Check (Moisture & Grade)'), desc: t('staff.journey_qc_desc', 'Assaying completed within tolerance limit') },
    { key: 'WEIGHING', label: t('lifecycle.weighing', 'Certified Weighing'), desc: t('staff.journey_weigh_desc', 'Gross, tare, and net weights confirmed') },
    { key: 'PROCUREMENT_CONFIRMED', label: t('lifecycle.confirmed', 'Procurement Confirmed'), desc: t('staff.journey_confirmed_desc', 'MSP rate verified & receipt issued') },
    { key: 'PAYMENT_PROCESSING', label: t('lifecycle.payment_processing', 'Payment Processing'), desc: t('staff.journey_payment_desc', 'Direct bank settlement in process') },
    { key: 'PAYMENT_COMPLETED', label: t('lifecycle.payment_completed', 'Payment Completed'), desc: t('staff.journey_settled_desc', 'Payment disbursed to farmer account') }
  ];

  const currentState = farmerEntry.state || farmerEntry.operationalStatus || 'WAITING';
  const currentIndex = STAGES.findIndex((s) => s.key === currentState);
  const safeIndex = currentIndex === -1 ? 0 : currentIndex;

  const isCanon = farmerEntry.tokenNumber === 'GOM01-109';
  const farmerName = farmerEntry.farmer?.fullName || farmerEntry.farmerName || (isCanon ? 'Ramesh Patel' : 'Farmer');
  const phone = farmerEntry.farmer?.phone || farmerEntry.phone || (isCanon ? '9876543210' : '+91 98765 43210');
  const village = farmerEntry.farmer?.villageName || farmerEntry.village || farmerEntry.villageName || (isCanon ? 'Chinhat' : 'Lucknow');
  const crop = farmerEntry.cropType || farmerEntry.commodity || 'Wheat';
  const qty = Number(farmerEntry.netWeightQuintals || farmerEntry.quantityQuintals || farmerEntry.estimatedQuantityQuintals || (isCanon ? 44.0 : 40));
  const mspRate = crop === 'Wheat' ? 2275 : crop === 'Paddy' ? 2300 : crop === 'Mustard' ? 5650 : crop === 'Pulses' ? 6600 : 2275;
  const grossPayable = Math.round(qty * mspRate);

  const getNextActionForState = (state) => {
    switch (state) {
      case 'WAITING':
        return { label: t('staff.call_next', 'Call Token'), nextState: 'CALLED' };
      case 'CALLED':
        return { label: t('staff.mark_arrived', 'Record Arrival'), nextState: 'ARRIVED' };
      case 'ARRIVED':
        return { label: t('staff.start_verification', 'Start Verification'), nextState: 'VERIFICATION' };
      case 'VERIFICATION':
        return { label: t('staff.start_qc', 'Send to Quality Assay'), nextState: 'QUALITY_CHECK' };
      case 'QUALITY_CHECK':
        return { label: t('staff.start_weighing', 'Send to Weighbridge'), nextState: 'WEIGHING' };
      case 'WEIGHING':
        return { label: t('staff.confirm_procurement', 'Confirm & Sign Receipt'), nextState: 'PROCUREMENT_CONFIRMED' };
      case 'PROCUREMENT_CONFIRMED':
        return { label: t('staff.initiate_payment', 'Initiate DBT Settlement'), nextState: 'PAYMENT_PROCESSING' };
      case 'PAYMENT_PROCESSING':
        return { label: t('staff.complete_payment', 'Mark Payment Disbursed'), nextState: 'PAYMENT_COMPLETED' };
      default:
        return null;
    }
  };

  const nextAction = getNextActionForState(currentState);
  const entryId = farmerEntry._id || farmerEntry.id;

  const drawerContent = (
    <div
      className="fixed inset-0 z-50 flex justify-end overflow-hidden"
      role="dialog"
      aria-modal="true"
      aria-label={t('staff.farmer_details', 'Farmer Dossier & Procurement Workspace')}
    >
      {/* Viewport Backdrop */}
      <div
        className="fixed inset-0 bg-dark-neutral/60 backdrop-blur-xs transition-opacity duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Viewport Anchored Workspace Panel */}
      <aside
        className="relative z-10 w-full max-w-full sm:max-w-lg lg:max-w-xl bg-white h-full shadow-2xl border-l-3 border-dark-neutral flex flex-col justify-between overflow-hidden animate-view-enter"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div className="p-4 sm:p-5 border-b-2 border-dark-neutral/10 bg-warm-ivory shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              {/* Hierarchy Breadcrumb */}
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-dark-neutral-muted uppercase tracking-wider mb-1.5 flex-wrap">
                <span className="text-forest-green font-black">Lucknow District (UP_LUK)</span>
                <span>→</span>
                <span>{farmerEntry.centreName || 'Procurement Centre'}</span>
                <span>→</span>
                <span className="font-mono text-dark-neutral font-black">Token #{farmerEntry.tokenNumber}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-wider text-forest-green bg-forest-green-light px-2 py-0.5 rounded-xs border border-dark-neutral shadow-[1px_1px_0px_#22252A]">
                  {activeView === 'DOSSIER' ? t('staff.farmer_details', 'FARMER DOSSIER') : t('staff.procurement_workspace', 'PROCUREMENT WORKSPACE')}
                </span>
                <span className="text-xs font-mono font-bold text-forest-green">
                  {farmerEntry.tokenNumber}
                </span>
              </div>
              <h3 className="text-xl font-black font-heading text-dark-neutral mt-1">
                {farmerName}
              </h3>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xs border-2 border-dark-neutral bg-white hover:bg-sand text-dark-neutral shadow-[2px_2px_0px_#22252A] transition-all hover:translate-x-0.5 hover:translate-y-0.5"
              aria-label={t('common.close', 'Close')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Drawer Mode Tabs */}
          <div className="flex items-center gap-2 mt-4 pt-2 border-t border-dark-neutral/10">
            <button
              type="button"
              onClick={() => setActiveView('DOSSIER')}
              className={`flex-1 py-1.5 px-3 text-xs font-black uppercase tracking-wider rounded-xs border-2 transition-all flex items-center justify-center gap-1.5 ${
                activeView === 'DOSSIER'
                  ? 'bg-forest-green text-white border-dark-neutral shadow-[2px_2px_0px_#22252A]'
                  : 'bg-white text-dark-neutral-muted border-dark-neutral/30 hover:border-dark-neutral hover:text-dark-neutral'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span>Dossier & History</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveView('WORKSPACE')}
              className={`flex-1 py-1.5 px-3 text-xs font-black uppercase tracking-wider rounded-xs border-2 transition-all flex items-center justify-center gap-1.5 ${
                activeView === 'WORKSPACE'
                  ? 'bg-forest-green text-white border-dark-neutral shadow-[2px_2px_0px_#22252A]'
                  : 'bg-white text-dark-neutral-muted border-dark-neutral/30 hover:border-dark-neutral hover:text-dark-neutral'
              }`}
            >
              <Briefcase className="w-3.5 h-3.5" />
              <span>Workspace Actions</span>
            </button>
          </div>
        </div>

        {/* Drawer Body - Scrollable Container */}
        <div className="p-5 space-y-6 flex-1 overflow-y-auto overscroll-contain">
          {activeView === 'DOSSIER' ? (
            <>
              {/* Key Farmer Data Cards */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2.5 bg-sand/30 rounded-xs border border-dark-neutral/30">
                  <span className="text-dark-neutral-muted block text-[10px] font-bold uppercase">Village / Locality</span>
                  <span className="font-bold text-dark-neutral flex items-center gap-1 mt-0.5">
                    <MapPin className="w-3 h-3 text-forest-green" />
                    {village}, Lucknow
                  </span>
                </div>

                <div className="p-2.5 bg-sand/30 rounded-xs border border-dark-neutral/30">
                  <span className="text-dark-neutral-muted block text-[10px] font-bold uppercase">Contact Number</span>
                  <span className="font-bold font-mono text-dark-neutral flex items-center gap-1 mt-0.5">
                    <Phone className="w-3 h-3 text-forest-green" />
                    {phone}
                  </span>
                </div>

                <div className="p-2.5 bg-sand/30 rounded-xs border border-dark-neutral/30">
                  <span className="text-dark-neutral-muted block text-[10px] font-bold uppercase">{t('farmer.produce_label', 'Commodity')}</span>
                  <span className="font-bold text-dark-neutral mt-0.5 block">
                    {getLocalizedCrop(crop, t)} • {qty} {t('common.quintals', 'Qtl')}
                  </span>
                </div>

                <div className="p-2.5 bg-sand/30 rounded-xs border border-dark-neutral/30">
                  <span className="text-dark-neutral-muted block text-[10px] font-bold uppercase">Scheduled Slot</span>
                  <span className="font-bold text-dark-neutral mt-0.5 block truncate">
                    {farmerEntry.timeWindow || '09:00 - 10:00 AM'}
                  </span>
                </div>

                <div className="p-2.5 bg-sand/30 rounded-xs border border-dark-neutral/30 col-span-2">
                  <span className="text-dark-neutral-muted block text-[10px] font-bold uppercase">Aadhaar Card (Identity Verification)</span>
                  <span className="font-bold font-mono text-dark-neutral mt-0.5 block flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-forest-green" />
                    <span>XXXX-XXXX-{farmerEntry.aadhaarLast4 || '4821'}</span>
                    <span className="text-[9px] font-sans font-bold text-emerald-800 bg-emerald-100 px-1.5 py-0.2 rounded border border-emerald-300">UIDAI Verified</span>
                  </span>
                </div>
              </div>

              {/* Canonical 10-Stage Procurement Journey Vertical Ladder */}
              <div>
                <h4 className="text-xs font-black uppercase text-dark-neutral tracking-wider mb-3">
                  {t('staff.procurement_journey', 'Canonical Procurement Journey')}
                </h4>

                <div className="space-y-3 relative pl-2 border-l-2 border-dark-neutral/20 ml-3">
                  {STAGES.map((stage, idx) => {
                    const isCompleted = idx < safeIndex;
                    const isCurrent = idx === safeIndex;

                    return (
                      <div key={stage.key} className="relative pl-6">
                        {/* Step Indicator Node */}
                        <div
                          className={`absolute -left-[17px] top-0.5 w-6 h-6 rounded-full border-2 flex items-center justify-center text-[10px] font-bold transition-all ${
                            isCompleted
                              ? 'bg-forest-green text-white border-dark-neutral shadow-[1px_1px_0px_#22252A]'
                              : isCurrent
                              ? 'bg-forest-green text-white border-dark-neutral ring-4 ring-forest-green/20 animate-pulse'
                              : 'bg-white text-dark-neutral-muted border-dark-neutral/30'
                          }`}
                        >
                          {isCompleted ? '✓' : isCurrent ? '●' : '○'}
                        </div>

                        <div className="text-xs">
                          <div className="flex items-center gap-2">
                            <span
                              className={`font-bold ${
                                isCurrent ? 'text-forest-green font-black text-sm' : isCompleted ? 'text-dark-neutral' : 'text-dark-neutral-muted'
                              }`}
                            >
                              {stage.label}
                            </span>
                            {isCurrent && (
                              <Badge variant="primary" size="sm">
                                {t('staff.active_now', 'ACTIVE')}
                              </Badge>
                            )}
                          </div>
                          <p className="text-[11px] text-dark-neutral-muted mt-0.5">
                            {stage.desc}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            /* Interactive Workspace Actions View */
            <div className="space-y-5">
              {/* Operational Status Banner */}
              <div className="p-4 bg-warm-ivory border-2 border-dark-neutral rounded-xs shadow-[2px_2px_0px_#22252A] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider text-dark-neutral-muted">Current Operational Station</span>
                  <Badge variant="primary" size="sm">{currentState}</Badge>
                </div>
                <div className="text-base font-black text-dark-neutral font-heading">
                  Stage {safeIndex + 1} of 10: {STAGES[safeIndex]?.label || currentState}
                </div>
                <p className="text-xs text-dark-neutral-muted">
                  {STAGES[safeIndex]?.desc || 'Awaiting counter operation.'}
                </p>
              </div>

              {/* Action Station Panel */}
              <div className="p-4 bg-emerald-50 border-2 border-forest-green rounded-xs shadow-[2px_2px_0px_#22252A] space-y-3">
                <div className="flex items-center gap-2 text-xs font-black uppercase text-forest-green">
                  <Sparkles className="w-4 h-4" />
                  <span>Immediate Action for This Token</span>
                </div>

                {nextAction ? (
                  <Button
                    variant="primary"
                    size="md"
                    fullWidth
                    disabled={isProcessing}
                    onClick={() => {
                      if (onAdvanceState) onAdvanceState(entryId, nextAction.nextState);
                    }}
                    className="font-black text-xs py-3 justify-center bg-forest-green hover:bg-forest-green-dark"
                  >
                    <span>{isProcessing ? 'Updating State...' : `Advance: ${nextAction.label} →`}</span>
                  </Button>
                ) : (
                  <div className="p-2.5 bg-white border border-dark-neutral/20 rounded-xs text-xs font-bold text-forest-green text-center">
                    ✓ Procurement lifecycle reached terminal completion!
                  </div>
                )}
              </div>

              {/* Commodity & Financial Estimate */}
              <div className="bg-sand/30 border border-dark-neutral/30 p-3.5 rounded-xs space-y-2 text-xs">
                <span className="text-[10px] font-black uppercase tracking-wider text-dark-neutral-muted block">Intake Weight & Payable Estimate</span>
                <div className="flex justify-between py-1 border-b border-dark-neutral/10">
                  <span className="text-dark-neutral-muted">Commodity:</span>
                  <span className="font-bold text-dark-neutral">{getLocalizedCrop(crop, t)}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-dark-neutral/10">
                  <span className="text-dark-neutral-muted">Intake Net Weight:</span>
                  <span className="font-black font-mono text-dark-neutral">{qty} Quintals</span>
                </div>
                <div className="flex justify-between py-1 border-b border-dark-neutral/10">
                  <span className="text-dark-neutral-muted">MSP Benchmark Rate:</span>
                  <span className="font-bold font-mono text-dark-neutral">₹{mspRate} / Qtl</span>
                </div>
                <div className="flex justify-between py-1 font-black text-forest-green text-sm">
                  <span>Gross Payable Amount:</span>
                  <span className="font-mono">₹{grossPayable.toLocaleString('en-IN')}</span>
                </div>
              </div>

              {/* Digital Receipt Trigger if available */}
              {(safeIndex >= 7 || ['PROCUREMENT_CONFIRMED', 'PAYMENT_PROCESSING', 'PAYMENT_COMPLETED', 'COMPLETED'].includes(currentState)) && (
                <Button
                  variant="outline"
                  size="md"
                  fullWidth
                  onClick={() => {
                    if (onViewReceipt) onViewReceipt(farmerEntry);
                  }}
                  className="font-black text-xs border-2 border-dark-neutral bg-white hover:bg-forest-green-light"
                >
                  <FileText className="w-4 h-4 mr-1.5 text-forest-green" />
                  <span>View Official Digital Receipt Slip</span>
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Drawer Footer Actions */}
        <div className="p-4 border-t-2 border-dark-neutral/10 bg-warm-ivory flex items-center justify-between gap-3 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            className="text-xs font-bold"
          >
            {t('common.close', 'Close')}
          </Button>

          <div className="flex items-center gap-2">
            {activeView === 'DOSSIER' ? (
              <Button
                variant="primary"
                size="sm"
                onClick={() => setActiveView('WORKSPACE')}
                className="text-xs font-black bg-forest-green hover:bg-forest-green-dark"
              >
                <span>{t('staff.serve_in_workspace', 'Serve in Workspace')}</span>
                <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  onClose();
                  onOpenInWorkspace && onOpenInWorkspace(farmerEntry);
                }}
                className="text-xs font-black bg-dark-neutral text-white hover:bg-dark-neutral/90"
              >
                <span>Open Full Tab →</span>
              </Button>
            )}
          </div>
        </div>
      </aside>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(drawerContent, document.body);
};

export default FarmerDetailDrawer;
