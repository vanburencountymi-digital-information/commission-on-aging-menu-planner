import axios from 'axios';

// The API is served from the same origin as the SPA, so VITE_API_URL stays unset
// and all calls are relative. Locally, the Vite dev proxy forwards /api/* to :3001.
const http = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '',
  withCredentials: true,
});

// Redirect to /login on any 401 except the auth/me check itself
http.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401 && !err.config.url?.includes('/auth/me')) {
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export const authApi = {
  me:     ()               => http.get('/api/auth/me').then(r => r.data),
  login:  (email, password) => http.post('/api/auth/login', { email, password }).then(r => r.data),
  logout: ()               => http.post('/api/auth/logout').then(r => r.data),
};

export const menusApi = {
  list:       (year, month)          => http.get('/api/menus', { params: { year, month } }).then(r => r.data),
  get:        (id)                   => http.get(`/api/menus/${id}`).then(r => r.data),
  create:     (year, month)          => http.post('/api/menus', { year, month }).then(r => r.data),
  addItem:    (menuId, dayId, data)  => http.post(`/api/menus/${menuId}/days/${dayId}/items`, data).then(r => r.data),
  removeItem: (menuId, dayId, itemId) => http.delete(`/api/menus/${menuId}/days/${dayId}/items/${itemId}`),
  updateDay:  (menuId, dayId, data)  => http.patch(`/api/menus/${menuId}/days/${dayId}`, data).then(r => r.data),
  updateNotes: (id, planning_notes)   => http.patch(`/api/menus/${id}`, { planning_notes }).then(r => r.data),
  generate:    (id)                   => http.post(`/api/menus/${id}/generate`).then(r => r.data),
  submit:      (id)                   => http.post(`/api/menus/${id}/submit`).then(r => r.data),
  approve:     (id)                   => http.post(`/api/menus/${id}/approve`).then(r => r.data),
  reject:      (id, rd_notes)         => http.post(`/api/menus/${id}/reject`, { rd_notes }).then(r => r.data),
  getNutrition:     (id)              => http.get(`/api/menus/${id}/nutrition`).then(r => r.data),
  explainNutrition: (id)              => http.get(`/api/menus/${id}/nutrition/explain`).then(r => r.data),
  getDayNutrition:  (id, dayId)       => http.get(`/api/menus/${id}/days/${dayId}/nutrition`).then(r => r.data),
  publish:          (id)              => http.post(`/api/menus/${id}/publish`).then(r => r.data),
  archive:          (id)              => http.post(`/api/menus/${id}/archive`).then(r => r.data),
  currentPublished: ()                => http.get('/api/menus/published/current').then(r => r.data),
  reviewSummary:      (id)            => http.get(`/api/menus/${id}/review-summary`).then(r => r.data),
  generateNarrative:  (id)            => http.post(`/api/menus/${id}/generate-narrative`).then(r => r.data),
  saveNarrative:      (id, narrative) => http.patch(`/api/menus/${id}/narrative`, { narrative }).then(r => r.data),
  edit:             (id, instruction) => http.post(`/api/menus/${id}/edit`, { instruction }).then(r => r.data),
  getSuggestions:   (id, dayId, conflictId) => http.post(`/api/menus/${id}/days/${dayId}/suggestions`, { conflict_id: conflictId }).then(r => r.data),
  setServings:      (id, dayId, estimated_servings) => http.patch(`/api/menus/${id}/days/${dayId}/servings`, { estimated_servings }).then(r => r.data),
  updateActuals:    (id, dayId, data) => http.patch(`/api/menus/${id}/days/${dayId}/actuals`, data).then(r => r.data),
  clearItems:       (id)              => http.delete(`/api/menus/${id}/items`).then(r => r.data),
  getOrderList:     (id, week, default_servings) => http.get(`/api/menus/${id}/order-list`, { params: { week, default_servings } }).then(r => r.data),
  orderListExportUrl: (id, week, format, default_servings) =>
    `${import.meta.env.VITE_API_URL ?? ''}/api/menus/${id}/order-list/export?week=${week}&format=${format}&default_servings=${default_servings}`,
};

export const approvalApi = {
  queue:   () => http.get('/api/approval/queue').then(r => r.data),
  history: () => http.get('/api/approval/history').then(r => r.data),
};

export const feedbackApi = {
  submit:      (data)     => http.post('/api/feedback', data).then(r => r.data),
  forMenu:     (menuId)   => http.get(`/api/feedback/menu/${menuId}`).then(r => r.data),
  recipeScore: (recipeId) => http.get(`/api/feedback/recipe/${recipeId}/score`).then(r => r.data),
  getInsights: ()         => http.get('/api/feedback/insights').then(r => r.data),
};

export const usersApi = {
  list:   ()         => http.get('/api/users').then(r => r.data),
  create: (data)     => http.post('/api/users', data).then(r => r.data),
  update: (id, data) => http.patch(`/api/users/${id}`, data).then(r => r.data),
};

export const frozenStockApi = {
  list:       (availableOnly = false) => http.get('/api/frozen-stock', { params: availableOnly ? { available_only: 1 } : {} }).then(r => r.data),
  report:     ()                      => http.get('/api/frozen-stock/report').then(r => r.data),
  create:     (data)                  => http.post('/api/frozen-stock', data).then(r => r.data),
  update:     (id, data)              => http.patch(`/api/frozen-stock/${id}`, data).then(r => r.data),
  remove:     (id)                    => http.delete(`/api/frozen-stock/${id}`),
};

export const helpApi = {
  ask: (message, history = [], page = '') =>
    http.post('/api/help', { message, history, page }).then(r => r.data),
};

export const recipesApi = {
  list:           (params)          => http.get('/api/recipes', { params }).then(r => r.data),
  get:            (id)              => http.get(`/api/recipes/${id}`).then(r => r.data),
  scale:          (id, n)           => http.get(`/api/recipes/${id}/scale/${n}`).then(r => r.data),
  create:         (data)            => http.post('/api/recipes', data).then(r => r.data),
  update:         (id, data)        => http.put(`/api/recipes/${id}`, data).then(r => r.data),
  setIngredients: (id, ingredients) => http.put(`/api/recipes/${id}/ingredients`, ingredients).then(r => r.data),
  recalculate:    (id)              => http.post(`/api/nutrition/recipe/${id}/recalculate`).then(r => r.data),
  getNutrition:   (id)              => http.get(`/api/nutrition/recipe/${id}`).then(r => r.data),
  usdaSearch:     (q)               => http.get('/api/nutrition/usda/search', { params: { q } }).then(r => r.data),
  usdaAiLink:     (ingredient_name, recipe_name, recipe_category) =>
                    http.post('/api/nutrition/usda/ai-link', { ingredient_name, recipe_name, recipe_category }).then(r => r.data),
  generate:        (data)                    => http.post('/api/recipes/generate', data).then(r => r.data),
  bulkSetVendor:   (recipe_ids, vendor)      => http.post('/api/recipes/bulk-set-vendor', { recipe_ids, vendor }).then(r => r.data),
  importRecipe:    (data)                    => http.post('/api/recipes/import', data).then(r => r.data),
  pendingReview:   ()                        => http.get('/api/recipes/pending-review').then(r => r.data),
};
