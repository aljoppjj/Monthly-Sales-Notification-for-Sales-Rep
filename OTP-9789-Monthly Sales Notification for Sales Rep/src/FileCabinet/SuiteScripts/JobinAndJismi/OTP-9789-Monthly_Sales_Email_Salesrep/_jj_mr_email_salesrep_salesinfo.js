/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
 
/*********************************************************************************
 * OTP-9789: Monthly Sales Notification for Sales Rep
 *
 * Author: Jobin & Jismi IT Services
 *
 * Date: 31-October-2025
 * 
 * Description: Send monthly email to sales reps with CSV of last month's sales.
 *              If no sales rep assigned, send to admin.
 *
 * REVISION HISTORY
 *
 * @version 1.0 : 31-October-2025 : Initial build created by JJ0417
 *
 *********************************************************************************/

define(['N/email', 'N/file', 'N/log', 'N/search'],
    function (email, file, log, search) {

        /**
         * Retrieves all sales transactions for the previous month
         * @returns {Search} NetSuite search object containing sales transactions
         */
        function getInputData() {
            try {
                log.audit('Script Started', 'Monthly Sales Notification');

                return search.create({
                    type: search.Type.SALES_ORDER,
                    filters: [
                        ['trandate', 'within', 'lastmonth'],
                        'AND',
                        ['mainline', 'is', 'T'],
                        'AND',
                        ['customer.isinactive', 'is', 'F']
                    ],
                    columns: [
                        search.createColumn({ name: 'tranid' }),
                        search.createColumn({ name: 'entity' }),
                        search.createColumn({ name: 'email', join: 'customer' }),
                        search.createColumn({ name: 'amount' }),
                        search.createColumn({ name: 'salesrep', join: 'customerMain' })
                    ]
                });

            } catch (e) {
                log.error('getInputData Error', e.message);
                throw e;
            }
        }

        /**
         * Processes each transaction and groups by sales rep
         * @param {Object} context - Map context object
         * @param {string} context.key - Transaction internal ID
         * @param {string} context.value - Transaction data as JSON string
         */
        function map(context) {
            try {
                const data = JSON.parse(context.value).values;
                let customerName = data.entity ? data.entity.text : 'Unknown';
                let customerEmail = data['email.customer'] || 'No Email';
                const docNumber = data.tranid || '';
                const amount = data.amount || '0.00';
                const salesRepId = data['salesrep.customerMain'] ? data['salesrep.customerMain'].value : 'Unassigned';

                if (customerName.includes(',')) customerName = `"${customerName}"`;
                if (customerEmail.includes(',')) customerEmail = `"${customerEmail}"`;

                const csvLine = `${customerName},${customerEmail},${docNumber},${amount}`;
                context.write({ key: salesRepId, value: csvLine });

            } catch (e) {
                log.error('Map Error', e.message);
            }
        }

        /**
         * Creates CSV file and sends email to sales rep or admin
         * @param {Object} context - Reduce context object
         * @param {string} context.key - Sales rep internal ID or 'Unassigned'
         * @param {Array} context.values - Array of CSV lines for this sales rep
         */
        function reduce(context) {
            try {
                const salesRepId = context.key;
                const allLines = context.values;
                const isUnassigned = salesRepId === 'Unassigned';

                const csvContent = 'Customer Name,Customer Email,Sales Order Document Number,Sales Amount\n' + allLines.join('\n');
                const csvFile = file.create({
                    name: `Sales_Report_${salesRepId}.csv`,
                    fileType: file.Type.CSV,
                    contents: csvContent,
                    folder: 1227
                });
                const fileId = csvFile.save();

                const senderName = search.lookupFields({
                    type: search.Type.EMPLOYEE,
                    id: -5,
                    columns: ['entityid']
                }).entityid || 'NetSuite Admin';
                
                let receiverName = 'Admin';
                if (!isUnassigned) {
                    try {
                        receiverName = search.lookupFields({
                            type: search.Type.EMPLOYEE,
                            id: salesRepId,
                            columns: ['entityid']
                        }).entityid || 'Sales Representative';
                    } catch (e) {
                        receiverName = 'Sales Representative';
                    }
                }
                
                const subject = isUnassigned ? 'Unassigned Sales Report' : 'Your Sales Report';
                const body = isUnassigned 
                    ? `Dear ${receiverName},\n\nPlease find attached the sales report containing customers without assigned sales representatives.\n\nKindly review and assign sales representatives to these customers.\n\nBest regards,\n${senderName}`
                    : `Dear ${receiverName},\n\nPlease find attached your monthly sales report.\n\nBest regards,\n${senderName}`;

                try {
                    email.send({
                        author: -5,
                        recipients: isUnassigned ? -5 : salesRepId,
                        subject: subject,
                        body: body,
                        attachments: [file.load({ id: fileId })]
                    });
                    log.audit('Email Sent', isUnassigned ? 'To admin' : `To sales rep`);
                } catch (e) {
                    log.audit('Email Skipped', `Sales rep has no email`);
                }

            } catch (e) {
                log.error('Reduce Error', `${context.key}: ${e.message}`);
            }
        }

        /**
         * Summarizes the script execution
         * @param {Object} summary - Summary context object
         */
        function summarize(summary) {
            log.audit('Script Completed', 'Map/Reduce finished successfully.');
        }

        return {
            getInputData: getInputData,
            map: map,
            reduce: reduce,
            summarize: summarize
        };
    });
