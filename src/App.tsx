import React, { useState, useEffect, useCallback } from 'react';
import { Navbar } from './components/Navbar';
import { Sidebar, TabType } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { ClientList } from './components/ClientList';
import { LoansManager } from './components/LoansManager';
import { CollectionsManager } from './components/CollectionsManager';
import { ClientModal } from './components/ClientModal';
import { ClientDetailModal } from './components/ClientDetailModal';
import { LoanModal } from './components/LoanModal';
import { PaymentModal } from './components/PaymentModal';
import { SettingsManager } from './components/SettingsManager';
import { RendicionesManager } from './components/RendicionesManager';
import { SupabaseConfigModal } from './components/SupabaseConfigModal';
import { AuthModal } from './components/AuthModal';
import {
  Client,
  ClientInput,
  Cobrador,
  CobradorInput,
  CollectionRow,
  EmisionParams,
  Loan,
  LoanInput,
  PaymentInput,
  Rendicion,
  Rubro,
  RubroInput,
  SupabaseCredentials,
  Zona,
  ZonaInput,
} from './types/database';
import { clientService } from './services/clientService';
import { loanService } from './services/loanService';
import { catalogService } from './services/catalogService';
import { rendicionService } from './services/rendicionService';
import { getSupabaseCredentials, getSupabaseClient } from './lib/supabase';
import { CheckCircle2, AlertCircle, Loader2, RefreshCw } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [clients, setClients] = useState<Client[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [collection, setCollection] = useState<CollectionRow[]>([]);
  const [zonas, setZonas] = useState<Zona[]>([]);
  const [cobradores, setCobradores] = useState<Cobrador[]>([]);
  const [rubros, setRubros] = useState<Rubro[]>([]);
  const [rendiciones, setRendiciones] = useState<Rendicion[]>([]);
  const [credentials, setCredentials] = useState<SupabaseCredentials>(getSupabaseCredentials());
  const [currentUser, setCurrentUser] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Modals
  const [isClientModalOpen, setIsClientModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);

  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  const [isLoanModalOpen, setIsLoanModalOpen] = useState(false);
  const [editingLoan, setEditingLoan] = useState<Loan | null>(null);

  const [collectingRow, setCollectingRow] = useState<CollectionRow | null>(null);

  const [isSupabaseConfigOpen, setIsSupabaseConfigOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  // Toast
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), type === 'error' ? 6000 : 3000);
  };

  const loadAllData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      // La cobranza en Modo Demo se arma cruzando los clientes, así que primero
      // hacen falta ellos.
      const clientData = await clientService.getClients();
      const [loanData, collectionData, zonaData, cobradorData, rubroData, rendicionData] =
        await Promise.all([
          loanService.getLoans(),
          loanService.getCollection(clientData),
          catalogService.getZonas(),
          catalogService.getCobradores(),
          catalogService.getRubros(),
          rendicionService.getRendiciones(),
        ]);

      setClients(clientData);
      setLoans(loanData);
      setCollection(collectionData);
      setZonas(zonaData);
      setCobradores(cobradorData);
      setRubros(rubroData);
      setRendiciones(rendicionData);
    } catch (err: any) {
      console.error('Error cargando datos del sistema:', err);
      setLoadError(err?.message || 'No se pudieron cargar los datos.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  // Sesión de Supabase Auth: estado inicial + cambios (login, logout, refresh).
  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setCurrentUser(null);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setCurrentUser(data.session?.user?.email ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setCurrentUser(session?.user?.email ?? null);
    });

    return () => subscription.unsubscribe();
  }, [credentials.url, credentials.anonKey]);

  const handleCredentialsUpdated = () => {
    const newCreds = getSupabaseCredentials();
    setCredentials(newCreds);
    loadAllData();
    showToast(
      newCreds.isConfigured
        ? '¡Conectado a Supabase Live exitosamente!'
        : 'Modo Local activado correctamente.'
    );
  };

  /** Ejecuta una operación de escritura mostrando el error real si falla. */
  const runAction = async (action: () => Promise<void>, successMessage: string) => {
    try {
      await action();
      await loadAllData();
      showToast(successMessage);
    } catch (err: any) {
      console.error(err);
      showToast(err?.message || 'La operación falló.', 'error');
      throw err;
    }
  };

  // --- Clientes -------------------------------------------------------------

  const handleSaveClient = async (clientData: ClientInput) => {
    const isEdit = Boolean(editingClient);
    await runAction(async () => {
      if (editingClient) {
        await clientService.updateClient(editingClient.id, clientData);
      } else {
        await clientService.createClient(clientData);
      }
    }, isEdit ? 'Cliente actualizado correctamente.' : 'Cliente creado correctamente.');
    setEditingClient(null);
  };

  const handleDeleteClient = async (id: string) => {
    const client = clients.find(c => c.id === id);
    const confirmed = window.confirm(
      `¿Eliminar a ${client?.name || 'este cliente'}? También se borran sus préstamos, cuotas y cobros registrados.`
    );
    if (!confirmed) return;

    try {
      await runAction(() => clientService.deleteClient(id), 'Cliente eliminado del sistema.');
    } catch {
      /* el toast ya informó el error */
    }
  };

  // --- Catálogo: zonas y cobradores -----------------------------------------

  /**
   * Alta al vuelo desde los formularios de cliente y préstamo. Devuelve el
   * nombre creado para que el select lo deje seleccionado. No usa runAction
   * porque el error lo muestra el propio CatalogSelect, sin cerrar el alta.
   */
  const handleQuickCreateZona = async (nombre: string): Promise<string> => {
    const zona = await catalogService.createZona({ nombre });
    setZonas(await catalogService.getZonas());
    return zona.nombre;
  };

  const handleQuickCreateCobrador = async (nombre: string): Promise<string> => {
    const cobrador = await catalogService.createCobrador({ nombre });
    setCobradores(await catalogService.getCobradores());
    return cobrador.nombre;
  };

  const handleQuickCreateRubro = async (nombre: string): Promise<string> => {
    const rubro = await catalogService.createRubro({ nombre });
    setRubros(await catalogService.getRubros());
    return rubro.nombre;
  };

  const handleCreateZona = async (input: ZonaInput) => {
    try {
      await runAction(
        () => catalogService.createZona(input).then(() => undefined),
        `Zona "${input.nombre}" creada.`
      );
    } catch {
      /* el toast ya informó el error */
    }
  };

  const handleUpdateZona = async (zona: Zona, input: ZonaInput) => {
    try {
      await runAction(
        () => catalogService.updateZona(zona, input).then(() => undefined),
        'Zona actualizada. Los clientes asignados se actualizaron solos.'
      );
    } catch {
      /* el toast ya informó el error */
    }
  };

  const handleDeleteZona = async (zona: Zona) => {
    const enUso = clients.filter(c => c.zona === zona.nombre).length;
    const confirmed = window.confirm(
      enUso > 0
        ? `${enUso} ${enUso === 1 ? 'cliente queda' : 'clientes quedan'} sin zona asignada. ¿Eliminar "${zona.nombre}"?`
        : `¿Eliminar la zona "${zona.nombre}"?`
    );
    if (!confirmed) return;

    try {
      await runAction(() => catalogService.deleteZona(zona), 'Zona eliminada.');
    } catch {
      /* el toast ya informó el error */
    }
  };

  const handleCreateCobrador = async (input: CobradorInput) => {
    try {
      await runAction(
        () => catalogService.createCobrador(input).then(() => undefined),
        `Cobrador "${input.nombre}" creado.`
      );
    } catch {
      /* el toast ya informó el error */
    }
  };

  const handleUpdateCobrador = async (cobrador: Cobrador, input: CobradorInput) => {
    try {
      await runAction(
        () => catalogService.updateCobrador(cobrador, input).then(() => undefined),
        'Cobrador actualizado. Sus clientes y préstamos se actualizaron solos.'
      );
    } catch {
      /* el toast ya informó el error */
    }
  };

  const handleDeleteCobrador = async (cobrador: Cobrador) => {
    const enUso = clients.filter(c => c.cobrador === cobrador.nombre).length;
    const confirmed = window.confirm(
      enUso > 0
        ? `${enUso} ${enUso === 1 ? 'cliente queda' : 'clientes quedan'} sin cobrador asignado. ¿Eliminar a "${cobrador.nombre}"? Los cobros que ya registró conservan su nombre.`
        : `¿Eliminar al cobrador "${cobrador.nombre}"?`
    );
    if (!confirmed) return;

    try {
      await runAction(() => catalogService.deleteCobrador(cobrador), 'Cobrador eliminado.');
    } catch {
      /* el toast ya informó el error */
    }
  };

  const handleCreateRubro = async (input: RubroInput) => {
    try {
      await runAction(
        () => catalogService.createRubro(input).then(() => undefined),
        `Rubro "${input.nombre}" creado.`
      );
    } catch {
      /* el toast ya informó el error */
    }
  };

  const handleUpdateRubro = async (rubro: Rubro, input: RubroInput) => {
    try {
      await runAction(
        () => catalogService.updateRubro(rubro, input).then(() => undefined),
        'Rubro actualizado. Los clientes asignados se actualizaron solos.'
      );
    } catch {
      /* el toast ya informó el error */
    }
  };

  const handleDeleteRubro = async (rubro: Rubro) => {
    const enUso = clients.filter(c => c.rubro === rubro.nombre).length;
    const confirmed = window.confirm(
      enUso > 0
        ? `${enUso} ${enUso === 1 ? 'cliente queda' : 'clientes quedan'} sin rubro asignado. ¿Eliminar "${rubro.nombre}"?`
        : `¿Eliminar el rubro "${rubro.nombre}"?`
    );
    if (!confirmed) return;

    try {
      await runAction(() => catalogService.deleteRubro(rubro), 'Rubro eliminado.');
    } catch {
      /* el toast ya informó el error */
    }
  };

  /** Edición puntual desde la ficha del cliente (por ahora, el rubro). */
  const handleUpdateClientField = async (client: Client, patch: Partial<Client>) => {
    const actualizado = await clientService.updateClient(client.id, patch);
    setClients(prev => prev.map(c => (c.id === client.id ? { ...c, ...actualizado } : c)));
    setSelectedClient(prev => (prev && prev.id === client.id ? { ...prev, ...actualizado } : prev));
  };

  const zonaNames = zonas.filter(z => z.activa).map(z => z.nombre);
  const cobradorNames = cobradores.filter(c => c.activo).map(c => c.nombre);
  const rubroNames = rubros.filter(r => r.activo).map(r => r.nombre);

  // --- Préstamos ------------------------------------------------------------

  const handleSaveLoan = async (loanData: LoanInput) => {
    const isEdit = Boolean(editingLoan);
    await runAction(async () => {
      if (editingLoan) {
        await loanService.updateLoan(editingLoan.id, loanData);
      } else {
        await loanService.createLoan(loanData);
      }
    }, isEdit ? 'Préstamo actualizado.' : 'Préstamo otorgado y plan de cuotas generado.');
    setEditingLoan(null);
  };

  const handleDeleteLoan = async (loan: Loan) => {
    const client = clients.find(c => c.id === loan.client_id);
    const confirmed = window.confirm(
      `¿Eliminar el préstamo de ${client?.name || 'este cliente'}? Se borran también sus cuotas y los cobros registrados.`
    );
    if (!confirmed) return;

    try {
      await runAction(() => loanService.deleteLoan(loan.id), 'Préstamo eliminado.');
    } catch {
      /* el toast ya informó el error */
    }
  };

  // --- Cobranza -------------------------------------------------------------

  const handleRegisterPayment = async (payment: PaymentInput) => {
    await runAction(
      () => loanService.registerPayment(payment).then(() => undefined),
      'Cobro registrado correctamente.'
    );
    setCollectingRow(null);
  };

  // --- Recibos y rendición ---------------------------------------------------

  /** Emite la planilla; el error lo muestra el propio formulario de emisión. */
  const handleEmitir = async (params: EmisionParams): Promise<Rendicion> => {
    const rendicion = await rendicionService.emitir(params);
    await loadAllData();
    showToast(`Planilla N° ${rendicion.numero} emitida con ${rendicion.cantidad_recibos} recibos.`);
    return rendicion;
  };

  const handleRendir = async (
    rendicion: Rendicion,
    montos: Record<string, number>,
    fecha: string
  ): Promise<void> => {
    await rendicionService.rendir(rendicion.id, montos, fecha);
    await loadAllData();
    showToast(`Planilla N° ${rendicion.numero} rendida. Los cobros quedaron registrados.`);
  };

  const handleAnularRendicion = async (rendicion: Rendicion) => {
    const confirmed = window.confirm(
      `¿Anular la planilla N° ${rendicion.numero}? Sus ${rendicion.cantidad_recibos} recibos quedan sin efecto y las cuotas vuelven a estar disponibles para emitir. Si ya se imprimieron, retiralos de la calle.`
    );
    if (!confirmed) return;

    try {
      await runAction(() => rendicionService.anular(rendicion), `Planilla N° ${rendicion.numero} anulada.`);
    } catch {
      /* el toast ya informó el error */
    }
  };

  const pendingInstallments = collection.filter(
    r => r.status !== 'paid' && r.loan_status !== 'cancelled'
  ).length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-[60] max-w-sm">
          <div
            className={`px-4 py-3 rounded-2xl shadow-2xl border text-xs font-semibold flex items-start gap-2.5 backdrop-blur-md ${
              toast.type === 'success'
                ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-200'
                : 'bg-rose-950/90 border-rose-500/40 text-rose-200'
            }`}
          >
            {toast.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            )}
            <span>{toast.message}</span>
          </div>
        </div>
      )}

      <Navbar
        credentials={credentials}
        onOpenSupabaseConfig={() => setIsSupabaseConfigOpen(true)}
        onOpenAuth={() => setIsAuthModalOpen(true)}
        onNewClient={() => {
          setEditingClient(null);
          setIsClientModalOpen(true);
        }}
        currentUser={currentUser}
      />

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        <Sidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          totalClients={clients.length}
          totalLoans={loans.filter(l => l.status === 'active').length}
          pendingInstallments={pendingInstallments}
          catalogCount={zonas.length + cobradores.length + rubros.length}
          openRendiciones={rendiciones.filter(r => r.estado === 'emitida').length}
          isSupabaseConfigured={credentials.isConfigured}
        />

        <main className="flex-1 p-4 md:p-8 overflow-y-auto max-w-7xl mx-auto w-full">
          {loadError && (
            <div className="mb-6 p-4 rounded-2xl bg-rose-950/40 border border-rose-500/30 text-rose-200 text-xs flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
              <div className="flex-1 space-y-1">
                <p className="font-bold">No se pudieron cargar los datos desde Supabase</p>
                <p className="text-rose-300/90">{loadError}</p>
              </div>
              <button
                onClick={loadAllData}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/30 text-rose-200 font-semibold transition-colors shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Reintentar
              </button>
            </div>
          )}

          {isLoading && (
            <div className="flex items-center gap-2 text-xs text-slate-400 mb-6">
              <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
              <span>Cargando datos...</span>
            </div>
          )}

          {activeTab === 'dashboard' && (
            <Dashboard
              clients={clients}
              loans={loans}
              collection={collection}
              onNewClient={() => {
                setEditingClient(null);
                setIsClientModalOpen(true);
              }}
              onNewLoan={() => {
                setEditingLoan(null);
                setIsLoanModalOpen(true);
              }}
              onSelectClient={client => {
                setSelectedClient(client);
                setIsDetailModalOpen(true);
              }}
              onNavigateTab={tab => setActiveTab(tab)}
            />
          )}

          {activeTab === 'clients' && (
            <ClientList
              clients={clients}
              onSelectClient={client => {
                setSelectedClient(client);
                setIsDetailModalOpen(true);
              }}
              onEditClient={client => {
                setEditingClient(client);
                setIsClientModalOpen(true);
              }}
              onDeleteClient={handleDeleteClient}
              onNewClient={() => {
                setEditingClient(null);
                setIsClientModalOpen(true);
              }}
            />
          )}

          {activeTab === 'loans' && (
            <LoansManager
              loans={loans}
              clients={clients}
              collection={collection}
              onNewLoan={() => {
                setEditingLoan(null);
                setIsLoanModalOpen(true);
              }}
              onEditLoan={loan => {
                setEditingLoan(loan);
                setIsLoanModalOpen(true);
              }}
              onDeleteLoan={handleDeleteLoan}
            />
          )}

          {activeTab === 'collections' && (
            <CollectionsManager
              rows={collection}
              onCollect={row => setCollectingRow(row)}
              onError={message => showToast(message, 'error')}
            />
          )}

          {activeTab === 'rendiciones' && (
            <RendicionesManager
              rendiciones={rendiciones}
              collection={collection}
              zonas={zonaNames}
              cobradores={cobradorNames}
              onEmitir={handleEmitir}
              onRendir={handleRendir}
              onAnular={handleAnularRendicion}
              onError={message => showToast(message, 'error')}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsManager
              zonas={zonas}
              cobradores={cobradores}
              rubros={rubros}
              clients={clients}
              onCreateZona={handleCreateZona}
              onUpdateZona={handleUpdateZona}
              onDeleteZona={handleDeleteZona}
              onCreateCobrador={handleCreateCobrador}
              onUpdateCobrador={handleUpdateCobrador}
              onDeleteCobrador={handleDeleteCobrador}
              onCreateRubro={handleCreateRubro}
              onUpdateRubro={handleUpdateRubro}
              onDeleteRubro={handleDeleteRubro}
            />
          )}

          {activeTab === 'supabase-config' && (
            <div className="space-y-6">
              <SupabaseConfigModal
                isOpen={true}
                onClose={() => setActiveTab('dashboard')}
                credentials={credentials}
                onCredentialsUpdated={handleCredentialsUpdated}
              />
            </div>
          )}
        </main>
      </div>

      {/* Modals */}
      <ClientModal
        isOpen={isClientModalOpen}
        onClose={() => {
          setIsClientModalOpen(false);
          setEditingClient(null);
        }}
        onSave={handleSaveClient}
        initialClient={editingClient}
        zonas={zonaNames}
        cobradores={cobradorNames}
        rubros={rubroNames}
        onCreateZona={handleQuickCreateZona}
        onCreateCobrador={handleQuickCreateCobrador}
        onCreateRubro={handleQuickCreateRubro}
      />

      <ClientDetailModal
        isOpen={isDetailModalOpen}
        onClose={() => setIsDetailModalOpen(false)}
        client={selectedClient}
        onClientUpdated={loadAllData}
        rubros={rubroNames}
        onCreateRubro={handleQuickCreateRubro}
        onUpdateClient={handleUpdateClientField}
        onNewLoan={client => {
          setSelectedClient(client);
          setEditingLoan(null);
          setIsDetailModalOpen(false);
          setIsLoanModalOpen(true);
        }}
      />

      <LoanModal
        isOpen={isLoanModalOpen}
        onClose={() => {
          setIsLoanModalOpen(false);
          setEditingLoan(null);
        }}
        onSave={handleSaveLoan}
        clients={clients}
        initialLoan={editingLoan}
        defaultClientId={selectedClient?.id}
        cobradores={cobradorNames}
        onCreateCobrador={handleQuickCreateCobrador}
      />

      <PaymentModal
        isOpen={Boolean(collectingRow)}
        onClose={() => setCollectingRow(null)}
        onSave={handleRegisterPayment}
        row={collectingRow}
      />

      {activeTab !== 'supabase-config' && (
        <SupabaseConfigModal
          isOpen={isSupabaseConfigOpen}
          onClose={() => setIsSupabaseConfigOpen(false)}
          credentials={credentials}
          onCredentialsUpdated={handleCredentialsUpdated}
        />
      )}

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        currentUser={currentUser}
        onUserChanged={user => setCurrentUser(user)}
      />
    </div>
  );
}
