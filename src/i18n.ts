import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const resources = {
    ru: {
        translation: {
            appName: "Kontrol Invoice",
            totalInvoices: "Всего инвойсов",
            overdue: "Просрочено",
            totalAmount: "Общая Сумма",
            searchPlaceholder: "Поиск по поставщику или ID...",

            filters: {
                all: "Все статусы",
                unpaid: "Не оплачен",
                pending: "В ожидании",
                paid: "Оплачен",
                overdue: "Просрочен",
            },

            table: {
                id: "ID",
                vendor: "Поставщик",
                created: "Создан",
                dueDate: "Срок оплаты",
                amount: "Сумма",
                status: "Статус",
                emptyTitle: "Инвойсы не найдены",
                emptyDesc: "Попробуйте изменить параметры фильтрации.",
            },

            errors: {
                loadingTitle: "Ошибка загрузки",
                loadingDesc: "Не удалось загрузить данные. Проверьте ссылку компании.",
            },

            loadingData: "Загрузка данных...",
        }
    },
    en: {
        translation: {
            appName: "Kontrol Invoice",
            totalInvoices: "Total Invoices",
            overdue: "Overdue",
            totalAmount: "Total Amount",
            searchPlaceholder: "Search by vendor or ID...",

            filters: {
                all: "All statuses",
                unpaid: "Unpaid",
                pending: "Pending",
                paid: "Paid",
                overdue: "Overdue",
            },

            table: {
                id: "ID",
                vendor: "Vendor",
                created: "Created",
                dueDate: "Due Date",
                amount: "Amount",
                status: "Status",
                emptyTitle: "No invoices found",
                emptyDesc: "Try adjusting your filter settings.",
            },

            errors: {
                loadingTitle: "Loading Error",
                loadingDesc: "Failed to load data. Please check the company's link.",
            },

            loadingData: "Loading data...",
        }
    },
    et: {
        translation: {
            appName: "Kontrol Invoice",
            totalInvoices: "Arveid Kokku",
            overdue: "Maksetähtaja Ületanud",
            totalAmount: "Kogusumma",
            searchPlaceholder: "Otsi tarnija või ID järgi...",

            filters: {
                all: "Kõik staatused",
                unpaid: "Maksmata",
                pending: "Ootel",
                paid: "Makstud",
                overdue: "Maksetähtaja ületanud",
            },

            table: {
                id: "ID",
                vendor: "Tarnija",
                created: "Loodud",
                dueDate: "Maksetähtaeg",
                amount: "Summa",
                status: "Staatus",
                emptyTitle: "Arveid ei leitud",
                emptyDesc: "Proovige muuta filtri seadeid.",
            },

            errors: {
                loadingTitle: "Laadimise viga",
                loadingDesc: "Andmete laadimine ebaõnnestus. Palun kontrollige ettevõtte linki.",
            },

            loadingData: "Andmete laadimine...",
        }
    }
};

i18n
    .use(initReactI18next)
    .init({
        resources,
        lng: "ru", // default language
        fallbackLng: "en",
        interpolation: {
            escapeValue: false
        }
    });

export default i18n;
