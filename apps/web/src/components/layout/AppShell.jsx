import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import Sidebar from './Sidebar';
import MenuCalendar from '../../pages/MenuCalendar';
import DRIReport from '../../pages/DRIReport';
import RDReview from '../../pages/RDReview';
import RDReviewDetail from '../../pages/RDReviewDetail';
import RecipeList from '../../pages/RecipeList';
import RecipeDetail from '../../pages/RecipeDetail';
import RecipeEditor from '../../pages/RecipeEditor';
import AdminUsers from '../../pages/AdminUsers';
import KitchenView from '../../pages/KitchenView';
import ClientRatings from '../../pages/ClientRatings';
import FrozenStock from '../../pages/FrozenStock';
import HelpAssistant from '../help/HelpAssistant';


export default function AppShell() {
  const { user } = useAuth();
  const isKitchen = user?.role === 'KITCHEN_STAFF';

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-hidden">
        <Routes>
          {/* KITCHEN_STAFF lands on /kitchen; redirect / to /kitchen for them */}
          <Route path="/"                element={isKitchen ? <Navigate to="/kitchen" replace /> : <MenuCalendar />} />
          <Route path="/kitchen"         element={<KitchenView />} />

          {/* Planner routes — redirect kitchen staff away */}
          <Route path="/recipes"         element={isKitchen ? <Navigate to="/kitchen" replace /> : <RecipeList />} />
          <Route path="/recipes/new"     element={isKitchen ? <Navigate to="/kitchen" replace /> : <RecipeEditor />} />
          <Route path="/recipes/:id"     element={isKitchen ? <Navigate to="/kitchen" replace /> : <RecipeDetail />} />
          <Route path="/recipes/:id/edit" element={isKitchen ? <Navigate to="/kitchen" replace /> : <RecipeEditor />} />
          <Route path="/approval"        element={isKitchen ? <Navigate to="/kitchen" replace /> : <RDReview />} />
          <Route path="/approval/:id"    element={isKitchen ? <Navigate to="/kitchen" replace /> : <RDReviewDetail />} />
          <Route path="/nutrition"       element={isKitchen ? <Navigate to="/kitchen" replace /> : <DRIReport />} />
          <Route path="/ratings"         element={<ClientRatings />} />
          <Route path="/frozen-stock"    element={<FrozenStock />} />
          <Route path="/admin/users"     element={<AdminUsers />} />
        </Routes>
      </main>
      {/* Floating AI help assistant — available on all pages */}
      <HelpAssistant />
    </div>
  );
}
