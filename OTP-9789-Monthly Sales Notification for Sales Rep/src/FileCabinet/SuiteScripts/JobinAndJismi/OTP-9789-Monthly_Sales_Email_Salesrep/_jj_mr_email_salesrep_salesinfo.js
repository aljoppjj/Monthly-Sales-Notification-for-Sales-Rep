/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
/*********************************************************************************
 * OTP-9789: Monthly Sales Notification for Sales Rep
 * Author: Jobin & Jismi IT Services
 * Date: 23-October-2025
 * 
 * Description: Send monthly email to sales reps with CSV of last month's sales.
 * If no sales rep assigned, send to admin.
 *********************************************************************************/
define(['N/email', 'N/file', 'N/log', 'N/search'],
(email, file, log, search) => {

    const getInputData = () => {
        try {
            log.audit('Script started', '');
            return search.create({
                type: 'transaction',
                filters: [
                    ['trandate', 'within', 'thismonth'],
                    'AND', ['mainline', 'is', 'T'],
                    'AND', ['type', 'anyof', 'CustInvc', 'CashSale'],
                    'AND', ['customer.isinactive', 'is', 'F']
                ],
                columns: [
                    { name: 'tranid' },
                    { name: 'entity' },
                    { name: 'email' },
                    { name: 'amount' },
                    { name: 'salesrep' }
                ]
            });
        } catch (e) {
            log.error('getInputData error', e.message);
            throw e;
        }
    };

    const map = (context) => {
        try {
            const data = JSON.parse(context.value).values;
            let customerName = data.entity?.text || 'Unknown';
            let customerEmail = data.email || 'No Email';
            let docNumber = data.tranid || 'Null';
            let amount = data.amount || '0.00';
            let salesRepId = data.salesrep?.value || 'Unassigned';

            if (customerName.includes(',')) customerName = `"${customerName}"`;
            if (customerEmail.includes(',')) customerEmail = `"${customerEmail}"`;

            const csvLine = `${customerName},${customerEmail},${docNumber},${amount}`;
            context.write({ key: salesRepId, value: csvLine });
        } catch (e) {
            log.error('Map error', e.message);
        }
    };

    const reduce = (context) => {
        try {
            const salesRepId = context.key;
            const allLines = context.values;

            const today = new Date();
            const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1);
            const monthName = ['January','February','March','April','May','June','July','August','September','October','November','December'][lastMonth.getMonth()];

            const csvContent = 'Customer Name,Customer Email,Document Number,Sales Amount\n' + allLines.join('\n');

            const csvFile = file.create({
                name: `Sales_Report_${salesRepId}_${monthName}.csv`,
                fileType: file.Type.CSV,
                contents: csvContent,
                folder: 624
            });
            csvFile.save();

            const isUnassigned = salesRepId === 'Unassigned';
            const recipient = isUnassigned ? -5 : salesRepId;
            const subject = isUnassigned
                ? `Unassigned Sales - ${monthName}`
                : `Your Sales Report - ${monthName}`;
            const body = isUnassigned
                ? `Hi,\n\nPlease assign sales reps to these customers.\n\nSee attached CSV.\n\nThank you.`
                : `Hi,\n\nYour monthly sales report for ${monthName} is attached.\n\nThank you.`;

            try {
                email.send({
                    author: -5,
                    recipients: recipient,
                    subject,
                    body,
                    attachments: [csvFile]
                });
                log.audit('Email sent', isUnassigned ? 'To admin' : `To sales rep ${salesRepId}`);
            } catch (e) {
                log.audit('Email skipped', `Sales rep ${salesRepId} has no email or cannot receive messages.`);
            }
        } catch (e) {
            log.error('Reduce error', `${context.key}: ${e.message}`);
        }
    };

    const summarize = (summary) => {
        log.audit('Script complete', 'Map/Reduce finished.');
    };

    return { getInputData, map, reduce, summarize };
});
