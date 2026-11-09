// pdfkit's browser build, with the two standard fonts the evidence dossier uses.
import PDFDocument, { registerStdFonts } from "pdfkit";
import Helvetica from "pdfkit/standard-fonts/Helvetica";
import HelveticaBold from "pdfkit/standard-fonts/HelveticaBold";
registerStdFonts(Helvetica, HelveticaBold);
export default PDFDocument;
