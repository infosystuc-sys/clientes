import React, { useState, useMemo } from 'react';
import { Search, Filter, Plus, Phone, MoreVertical, Edit2, Trash2, Eye, Download, LayoutGrid, List, UserCheck, Shield, MapPin, Map } from 'lucide-react';
import { Client, ClientStatus } from '../types/database';

interface ClientListProps {
  clients: Client[];
  onSelectClient: (client: Client) => void;
  onEditClient: (client: Client) => void;
  onDeleteClient: (id: string) => void;
  onNewClient: () => void;
}

export const ClientList: React.FC<ClientListProps> = ({
  clients,
  onSelectClient,
  onEditClient,
  onDeleteClient,
  onNewClient,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedRubro, setSelectedRubro] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');

  const filteredClients = useMemo(() => {
    return clients.filter(c => {
      const term = searchTerm.toLowerCase();
      const matchesSearch =
        !term ||
        [c.name, c.address, c.zona, c.cobrador, c.rubro, c.company, c.email]
          .filter(Boolean)
          .some(field => String(field).toLowerCase().includes(term)) ||
        (c.phone || '').includes(searchTerm) ||
        String(c.numero ?? '') === searchTerm.trim();

      const matchesStatus = selectedStatus === 'all' || c.status === selectedStatus;
      const matchesRubro = selectedRubro === 'all' || (c.rubro || '') === selectedRubro;

      return matchesSearch && matchesStatus && matchesRubro;
    });
  }, [clients, searchTerm, selectedStatus, selectedRubro]);

  const rubroOptions = useMemo(
    () => Array.from(new Set(clients.map(c => c.rubro).filter(Boolean) as string[])).sort(),
    [clients]
  );

  const handleExportCSV = () => {
    if (!filteredClients.length) return;

    const headers = [
      'N° Cliente',
      'Nombre y Apellido',
      'Domicilio',
      'Teléfono',
      'Zona',
      'Cobrador',
      'Rubro',
      'Estado',
      'Fecha Registro',
    ];
    const rows = filteredClients.map(c => [
      c.numero ?? '',
      `"${c.name}"`,
      `"${(c.address || '').replace(/"/g, '""')}"`,
      `"${c.phone || ''}"`,
      `"${c.zona || ''}"`,
      `"${c.cobrador || ''}"`,
      `"${c.rubro || ''}"`,
      c.status,
      c.created_at,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `clientes_export_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);
  };

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Directorio de Clientes</h2>
          <p className="text-xs text-slate-400">
            Gestiona la información, contratos e historial de tus {clients.length} clientes.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition-colors"
            title="Exportar a CSV"
          >
            <Download className="w-4 h-4 text-emerald-400" />
            <span className="hidden sm:inline">Exportar CSV</span>
          </button>

          <button
            onClick={onNewClient}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs shadow-lg shadow-blue-500/25 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Agregar Cliente</span>
          </button>
        </div>
      </div>

      {/* Search Bar & Filters */}
      <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3">
        <div className="flex flex-col md:flex-row items-center gap-3">
          {/* Search Input */}
          <div className="relative w-full md:flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar por N°, nombre, domicilio, teléfono, zona o cobrador..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>

          {/* Rubro Dropdown */}
          <div className="flex items-center gap-2 w-full md:w-auto">
            <Filter className="w-4 h-4 text-slate-400 hidden sm:block" />
            <select
              value={selectedRubro}
              onChange={e => setSelectedRubro(e.target.value)}
              className="w-full md:w-44 px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 text-xs focus:outline-none focus:border-blue-500"
            >
              <option value="all">Todos los rubros</option>
              {rubroOptions.map(r => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          {/* View Switcher */}
          <div className="flex items-center bg-slate-950 border border-slate-800 p-1 rounded-xl">
            <button
              onClick={() => setViewMode('table')}
              className={`p-1.5 rounded-lg transition-colors ${
                viewMode === 'table' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Vista en Tabla"
            >
              <List className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-lg transition-colors ${
                viewMode === 'grid' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Vista en Tarjetas"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pt-1 pb-0.5 no-scrollbar">
          {[
            { id: 'all', label: 'Todos' },
            { id: 'active', label: 'Activos' },
            { id: 'vip', label: 'VIP' },
            { id: 'lead', label: 'Prospectos (Lead)' },
            { id: 'inactive', label: 'Inactivos' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setSelectedStatus(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                selectedStatus === tab.id
                  ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                  : 'text-slate-400 hover:text-slate-300 hover:bg-slate-800/60'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content Area */}
      {filteredClients.length === 0 ? (
        <div className="p-12 rounded-2xl bg-slate-900/60 border border-slate-800 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-slate-800 mx-auto flex items-center justify-center text-slate-500">
            <UserCheck className="w-6 h-6" />
          </div>
          <h3 className="font-bold text-base text-slate-200">No se encontraron clientes</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            Intenta cambiar los términos de búsqueda o filtros, o crea un nuevo cliente.
          </p>
          <button
            onClick={onNewClient}
            className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-medium"
          >
            <Plus className="w-4 h-4" />
            <span>Crear Cliente</span>
          </button>
        </div>
      ) : viewMode === 'table' ? (
        /* TABLE VIEW */
        <div className="rounded-2xl bg-slate-900/80 border border-slate-800 overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800 font-semibold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="py-3.5 px-4">Cliente / Zona</th>
                  <th className="py-3.5 px-4">Domicilio / Teléfono</th>
                  <th className="py-3.5 px-4">Estado</th>
                  <th className="py-3.5 px-4">Rubro</th>
                  <th className="py-3.5 px-4 text-right">Inversión Total</th>
                  <th className="py-3.5 px-4 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {filteredClients.map(client => (
                  <tr
                    key={client.id}
                    className="hover:bg-slate-800/40 transition-colors group cursor-pointer"
                    onClick={() => onSelectClient(client)}
                  >
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center font-bold text-white text-xs shrink-0">
                          {client.name.charAt(0)}
                        </div>
                        <div>
                          <p className="font-bold text-white group-hover:text-blue-400 transition-colors">
                            {client.numero && (
                              <span className="font-mono text-[11px] text-slate-500 mr-1.5">
                                N° {client.numero}
                              </span>
                            )}
                            {client.name}
                          </p>
                          <p className="text-[11px] text-slate-400 flex items-center gap-1">
                            <Map className="w-3 h-3 text-slate-500" />{' '}
                            {client.zona || <span className="text-slate-600">Sin zona</span>}
                            {client.cobrador && (
                              <span className="flex items-center gap-1 text-slate-500">
                                • <UserCheck className="w-3 h-3" /> {client.cobrador}
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                    </td>

                    <td className="py-3.5 px-4 space-y-0.5 max-w-xs">
                      <p className="flex items-start gap-1.5 text-slate-300">
                        <MapPin className="w-3 h-3 text-slate-500 shrink-0 mt-0.5" />{' '}
                        {client.address}
                      </p>
                      {client.phone && (
                        <p className="flex items-center gap-1.5 text-slate-400 text-[11px]">
                          <Phone className="w-3 h-3 text-slate-500" /> {client.phone}
                        </p>
                      )}
                    </td>

                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold capitalize ${
                          client.status === 'vip'
                            ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                            : client.status === 'active'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : client.status === 'lead'
                            ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-current"></span>
                        {client.status}
                      </span>
                    </td>

                    <td className="py-3.5 px-4">
                      {client.rubro ? (
                        <span className="px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700 text-slate-300 text-[11px]">
                          {client.rubro}
                        </span>
                      ) : (
                        <span className="text-slate-600 text-[11px]">—</span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 text-right font-bold text-white">
                      {formatCurrency(client.total_spent)}
                    </td>

                    <td className="py-3.5 px-4" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => onSelectClient(client)}
                          className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-blue-400 transition-colors"
                          title="Ver Detalle"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => onEditClient(client)}
                          className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-amber-400 transition-colors"
                          title="Editar"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => onDeleteClient(client.id)}
                          className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-rose-400 transition-colors"
                          title="Eliminar"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* GRID CARDS VIEW */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredClients.map(client => (
            <div
              key={client.id}
              onClick={() => onSelectClient(client)}
              className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 hover:border-slate-700 transition-all cursor-pointer space-y-4 group"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center font-bold text-white text-sm">
                    {client.name.charAt(0)}
                  </div>
                  <div>
                    <h3 className="font-bold text-white group-hover:text-blue-400 transition-colors">
                      {client.name}
                    </h3>
                    {client.numero && (
                      <p className="font-mono text-[10px] text-slate-500">N° {client.numero}</p>
                    )}
                    <p className="text-xs text-slate-400 flex items-center gap-1">
                      <Map className="w-3 h-3 text-slate-500" />{' '}
                      {client.zona || <span className="text-slate-600">Sin zona</span>}
                    </p>
                  </div>
                </div>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold capitalize ${
                    client.status === 'vip'
                      ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                      : client.status === 'active'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : client.status === 'lead'
                      ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {client.status}
                </span>
              </div>

              <div className="space-y-1.5 text-xs text-slate-400 border-t border-b border-slate-800/80 py-3">
                <p className="flex items-start gap-2">
                  <MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" /> {client.address}
                </p>
                {client.phone && (
                  <p className="flex items-center gap-2 font-mono">
                    <Phone className="w-3.5 h-3.5 text-slate-500" /> {client.phone}
                  </p>
                )}
                {client.cobrador && (
                  <p className="flex items-center gap-2">
                    <UserCheck className="w-3.5 h-3.5 text-slate-500" /> {client.cobrador}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between pt-1">
                <div>
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
                    Facturación
                  </span>
                  <p className="text-sm font-bold text-white">{formatCurrency(client.total_spent)}</p>
                </div>
                <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => onEditClient(client)}
                    className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-amber-400"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onDeleteClient(client.id)}
                    className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-rose-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
