export interface Company {
    id: string;
    name: string;
    csvUrl: string;
}

// По умолчанию мы используем демо-компании для показа интерфейса
const defaultCompanies: Company[] = [
    {
        id: 'demo-company',
        name: 'Демо Компания',
        csvUrl: '' // Empty means we use mockInvoices
    }
];

export const getCompaniesConfig = (): Company[] => {
    const jsonConfig = import.meta.env.VITE_COMPANIES_JSON;
    if (jsonConfig) {
        try {
            return JSON.parse(jsonConfig) as Company[];
        } catch (e) {
            console.error("Failed to parse VITE_COMPANIES_JSON from environment variables.", e);
        }
    }

    // Если есть старый одиночный URL (для обратной совместимости)
    const singleUrl = import.meta.env.VITE_GOOGLE_SHEETS_CSV_URL;
    if (singleUrl) {
        return [
            {
                id: 'main-company',
                name: 'Основная Компания',
                csvUrl: singleUrl
            }
        ];
    }

    return defaultCompanies;
};
