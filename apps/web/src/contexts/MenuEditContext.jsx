import { createContext, useContext } from 'react';

/**
 * Provides NL-edit context to the HelpAssistant popup so it can show
 * an "Edit Menu" tab when a DRAFT menu is active on the calendar page.
 *
 * Value shape:
 *   { menuId, menuDays, menuStatus, canEdit, onChangesApplied }
 */
const MenuEditContext = createContext(null);

export function MenuEditProvider({ children, value }) {
  return <MenuEditContext.Provider value={value}>{children}</MenuEditContext.Provider>;
}

export function useMenuEdit() {
  return useContext(MenuEditContext);
}
