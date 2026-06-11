import express from 'express';
import { Request, Response } from 'express';
import mysql from 'mysql2';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json()); // لتمكين السيرفر من قراءة بيانات JSON القادمة من المنيو

// 1. إعداد الاتصال بقاعدة بيانات MySQL السحابية (Aiven Cloud)
const db = mysql.createConnection({
    host: 'mysql-1dfaa1b-symaalkhtyb18-5bb4.d.aivencloud.com',
    port: 10568,
    user: 'avnadmin',
    password: 'AVNS_H1zYGi2k8zhzvtvuQNA', 
    database: 'defaultdb',
    ssl: {
        rejectUnauthorized: false // تفعيل حماية SSL المطلوبة للسيرفرات السحابية
    }
});

db.connect((err) => {
    if (err) {
        console.error('خطأ في الاتصال بقاعدة البيانات السحابية: ' + err.message);
        return;
    }
    console.log('تم الاتصال بنجاح بقاعدة بيانات MySQL السحابية (defaultdb)');

    // إنشاء جدول orders تلقائياً في السحاب إذا لم يكن موجوداً
    const createOrdersTable = `
        CREATE TABLE IF NOT EXISTS orders (
            order_id VARCHAR(50) PRIMARY KEY,
            table_number INT NOT NULL,
            subtotal DECIMAL(10,2) NOT NULL,
            additions_cost DECIMAL(10,2) DEFAULT 0.00,
            final_total DECIMAL(10,2) NOT NULL,
            status VARCHAR(20) DEFAULT 'Pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `;

    // إنشاء جدول order_items تلقائياً في السحاب إذا لم يكن موجوداً
    const createOrderItemsTable = `
        CREATE TABLE IF NOT EXISTS order_items (
            id INT AUTO_INCREMENT PRIMARY KEY,
            order_id VARCHAR(50),
            item_name VARCHAR(100) NOT NULL,
            price DECIMAL(10,2) NOT NULL,
            quantity INT NOT NULL,
            custom_notes TEXT,
            FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE
        );
    `;

    // تنفيذ بناء الجداول السحابية فوراً عند أول تشغيل
    db.query(createOrdersTable, (err) => {
        if (err) console.error('خطأ في إنشاء جدول orders السحابي:', err);
        else {
            db.query(createOrderItemsTable, (itemErr) => {
                if (itemErr) console.error('خطأ في إنشاء جدول order_items السحابي:', itemErr);
                else console.log('✨ تم التأكد من جاهزية وبناء الجداول السحابية بنجاح تام على Aiven!');
            });
        }
    });
});

// 2. الـ API الخاص بجلب الطلبات المفلترة برقم الطاولة (لحل مشكلة تكدس طلبات الزبائن الآخرين)
app.get('/api/orders', (req: Request, res: Response) => {
    const tableNumber = req.query.table; // استقبال رقم الطاولة كـ Query Parameter من الـ React

    if (!tableNumber) {
        return res.status(400).json({ error: 'رقم الطاولة مطلوب لفلترة البيانات وعرض الفواتير الصحيحة' });
    }

    // استعلام محدد لجلب طلبات هذه الطاولة فقط مرتبة من الأحدث إلى الأقدم
    const query = `SELECT * FROM orders WHERE table_number = ? ORDER BY created_at DESC`;
    
    db.query(query, [tableNumber], (err, results) => {
        if (err) {
            console.error('خطأ أثناء جلب الطلبات المفلترة من الـ SQL:', err);
            return res.status(500).json({ error: 'حدث خطأ في السيرفر أثناء جلب البيانات' });
        }
        return res.json(results);
    });
});

// 3. الـ API الخاص باستقبال وحفظ الفاتورة والطلبات الكاملة من السلة
app.post('/api/orders', (req: Request, res: Response) => {
    const { order_id, table_number, subtotal, additions_cost, final_total, items } = req.body;

    // أ. إدخال الطلب الرئيسي في جدول orders
    const orderQuery = `INSERT INTO orders (order_id, table_number, subtotal, additions_cost, final_total) VALUES (?, ?, ?, ?, ?)`;
    
    db.query(orderQuery, [order_id, table_number, subtotal, additions_cost, final_total], (err, result) => {
        if (err) {
            console.error('خطأ أثناء حفظ الطلب الرئيسي:', err);
            return res.status(500).json({ error: 'حدث خطأ في السيرفر أثناء حفظ الطلب' });
        }

        // ب. إدخال الأصناف التابعة لهذه الفاتورة في جدول order_items
        if (items && items.length > 0) {
            const itemQuery = `INSERT INTO order_items (order_id, item_name, price, quantity, custom_notes) VALUES ?`;
            
            // تجهيز البيانات المصفوفة للإدخال الجماعي
            const itemValues = items.map((item: any) => [
                order_id,
                item.name,
                item.price,
                item.quantity,
                item.notes || ''
            ]);

            db.query(itemQuery, [itemValues], (itemErr, itemResult) => {
                if (itemErr) {
                    console.error('خطأ أثناء حفظ أصناف الطلب:', itemErr);
                    return res.status(500).json({ error: 'حدث خطأ أثناء حفظ أصناف الطلب الفردية' });
                }
                
                // تم حفظ الفاتورة والأصناف بنجاح تام في الـ SQL
                return res.status(201).json({ success: true, message: 'تم تسجيل الفاتورة بنجاح في قاعدة البيانات السحابية!' });
            });
        } else {
            return res.status(201).json({ success: true, message: 'تم تسجيل الطلب الرئيسي بدون أصناف' });
        }
    });
});

// 4. تشغيل السيرفر وتحديد المنفذ
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
    console.log(`السيرفر يعمل الآن بنجاح على المنفذ ${PORT}`);
});
