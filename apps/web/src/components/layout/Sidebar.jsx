import { NavLink } from 'react-router-dom';
import { Calendar, UtensilsCrossed, CheckSquare, BarChart3, Star, Users, ChefHat, LogOut, Snowflake } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

const PLANNER_NAV = [
  { to: '/',              icon: Calendar,        label: 'Monthly Menu',    end: true },
  { to: '/recipes',       icon: UtensilsCrossed, label: 'Recipes'               },
  { to: '/approval',      icon: CheckSquare,     label: 'RD Approval'           },
  { to: '/nutrition',     icon: BarChart3,       label: 'Nutrition Report'      },
  { to: '/ratings',       icon: Star,            label: 'Client Ratings'        },
  { to: '/frozen-stock',  icon: Snowflake,       label: 'Frozen Stock'          },
];

const KITCHEN_NAV = [
  { to: '/kitchen',      icon: ChefHat,    label: 'Current Menu',  end: true },
  { to: '/frozen-stock', icon: Snowflake,  label: 'Frozen Stock'              },
];

const ADMIN_NAV = [
  { to: '/admin/users', icon: Users, label: 'User Management' },
];

export default function Sidebar() {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const isKitchen = user?.role === 'KITCHEN_STAFF';
  const NAV = isKitchen ? KITCHEN_NAV : PLANNER_NAV;

  return (
    <aside className="w-56 bg-slate-900 flex flex-col text-white flex-shrink-0">
      <div className="px-4 py-5 border-b border-slate-700">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">COA Menu Planner</p>
      </div>

      <nav className="flex-1 px-2 py-4 space-y-0.5">
        {NAV.map(({ to, icon: Icon, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                isActive
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`
            }
          >
            <Icon size={15} />
            {label}
          </NavLink>
        ))}

        {isAdmin && (
          <>
            <div className="pt-3 pb-1 px-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-600">Admin</p>
            </div>
            {ADMIN_NAV.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                    isActive
                      ? 'bg-slate-700 text-white'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`
                }
              >
                <Icon size={15} />
                {label}
              </NavLink>
            ))}
          </>
        )}
      </nav>

      {user && (
        <div className="px-4 py-4 border-t border-slate-700">
          <p className="text-sm font-medium truncate">{user.name}</p>
          <p className="text-xs text-slate-400 mb-3">{user.role.replaceAll('_', ' ')}</p>
          <button
            onClick={logout}
            className="flex items-center gap-2 text-xs text-slate-400 hover:text-white transition-colors"
          >
            <LogOut size={13} />
            Log out
          </button>
        </div>
      )}
    </aside>
  );
}
