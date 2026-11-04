-- NO ACTION provjera mora biti ODGOĐENA do kraja transakcije. Inače brisanje cijele forme ili ankete (kaskada) može
-- pasti ovisno o redoslijedu kaskadnih brisanja: pitanje bi se obrisalo prije svojih odgovora i FK bi se okinuo.
-- Odgođena provjera i dalje blokira brisanje pitanja/opcije koji imaju odgovore/glasove (greška pri commit-u),
-- ali dozvoljava da se kaskadom obriše forma/anketa/događaj zajedno sa svim zavisnim redovima.
ALTER TABLE "FeedbackAnswer" ALTER CONSTRAINT "FeedbackAnswer_formId_questionId_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "LunchVote" ALTER CONSTRAINT "LunchVote_pollId_optionId_fkey" DEFERRABLE INITIALLY DEFERRED;
