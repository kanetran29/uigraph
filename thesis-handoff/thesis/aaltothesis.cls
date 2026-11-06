%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
%%                                                                            %%
%% LaTeX document class 'aaltothesis', for use with pdflatex.                 %%
%% This is a class for typesetting theses to be submitted for examination to  %%
%% the Aalto University School of Electrical Engineering, which may be        %%
%% extended for use in other Aalto schools as well. This class file is        %%
%% designed to be used with the template files opinnaytepohja.tex (Finnish),  %%
%% thesistemplate.tex (English) and kandidatarbetsbotten.tex (Swedish). The   %%
%% template can be used in Swedish by saying "swedish" as the language option %%
%% in the \documentclass. This class enables the production of a PDF/A-1b or  %% 
%% PDF/A-2b compliant file as made possible by the pdfx.sty package.          %%
%%                                                                            %%
%% This class package requires pdfx.sty v. 1.5.84 (2017/05/18) or newer.      %%
%%                                                                            %%
%%                                                                            %%
%% Written by Luis R.J. Costa.                                                %%
%% Developed at the Learning Services of Aalto University School of           %%
%% Electrical Engineering by Luis R.J. Costa from May 2017 to November 2019.  %%
%% Currently developed and maintained by Luis R.J. Costa in Learning Services,%%
%% Teacher Services team since December 2019.                                 %%
%%                                                                            %%
%% This is licensed under the terms of the MIT license below.                 %%
%%                                                                            %%
%% Copyright 2017-2025 aaltothesis.cls by Luis R.J. Costa,                    %%
%% luis.costa@aalto.fi.                                                       %%
%% Copyright 2017-2018 Swedish translations in aaltothesis.cls by Elisabeth   %%
%% Nyberg and Henrik Wallén henrik.wallen@aalto.fi.                           %%
%% Copyright 2017-2018 Finnish documentation in the template opinnatepohja.tex%%
%% by Perttu Puska, perttu.puska@aalto.fi, and Luis R.J. Costa.               %%
%% Finnish documentation in the template opinnatepohja.tex translated from    %%
%% the English template documentation.                                        %%
%% Copyright 2025 English template thesistemplate.tex by Luis R.J. Costa,     %%
%% Maurice Forget, Henrik Wallén.                                             %%
%% Copyright 2018-2025 Swedish template kandidatarbetsbotten.tex by Henrik    %%
%% Wallen.                                                                    %%
%%                                                                            %%
%% Permission is hereby granted, free of charge, to any person obtaining a    %%
%% copy of this software and associated documentation files (the "Software"), %%
%% to deal in the Software without restriction, including without limitation  %%
%% the rights to use, copy, modify, merge, publish, distribute, sublicense,   %%
%% and/or sell copies of the Software, and to permit persons to whom the      %%
%% Software is furnished to do so, subject to the following conditions:       %%
%% The above copyright notice and this permission notice shall be included in %%
%% all copies or substantial portions of the Software.                        %%
%% THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR %%
%% IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,   %%
%% FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE%%
%% AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER     %%
%% LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING    %%
%% FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER        %%
%% DEALINGS IN THE SOFTWARE.                                                  %%
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
%%
%% For developers
%% --------------
%% Adding a new language:
%% 1. Add the language option using \DeclareOption as done a few lines below.
%%    Your language is assumed to be supported by the babel package.
%% 2. Add your language to the options passed to babel
%% 3. Make a corresponding short-hand macro \IfYourlang (under "Some shorthand")
%% 4. Add the translations to the macros \setthesismainlangnames and
%%    \setabstractlangnames.
%% 5. Make the corresponding additions to the macros \L@ng and \settocabslang.
%% 6. Make your language option available in the abstractpage environment.
%%
%%
\NeedsTeXFormat{LaTeX2e}%
\ProvidesClass{aaltothesis}[2025-09-30 Aalto University thesis class v4.20]%
\RequirePackage{etoolbox}% Defines boolean/toggle variables, ifs, AtEndPreamble..
%
% Language options for user
\newcommand*{\MainLang}{}%
\newcommand*{\MetaDataLang}{}%
\newcommand*{\OtherLangs}{}%
\newcommand*{\LogoLang}{}% used to build the logo file name
\DeclareOption{english}{%
%  \AtEndOfClass{\main@language{english}}%
%  \PassOptionsToPackage{main=english, swedish, finnish}{babel}%
  \renewcommand*{\MainLang}{english}%
  \renewcommand*{\MetaDataLang}{en}%
  \renewcommand*{\OtherLangs}{finnish, swedish}%
  \renewcommand*{\LogoLang}{en}%
}%
\DeclareOption{finnish}{%
%  \AtEndOfClass{\main@language{finnish}}%
  \PassOptionsToPackage{main=finnish, english, swedish}{babel}%
  \renewcommand*{\MainLang}{finnish}%
  \renewcommand*{\MetaDataLang}{fi}%
  \renewcommand*{\OtherLangs}{english, swedish}%
  \renewcommand*{\LogoLang}{fi}%
}%
\DeclareOption{swedish}{%
%  \AtEndOfClass{\main@language{swedish}}%
  \PassOptionsToPackage{main=swedish, english, finnish}{babel}%
  \renewcommand*{\MainLang}{swedish}%
  \renewcommand*{\MetaDataLang}{sv}%
  \renewcommand*{\OtherLangs}{english, finnish}%
  \renewcommand*{\LogoLang}{sv}%
}%
%%
%% School options for user; determines logo text
\newtoggle{ARTS}%
\newtoggle{BIZ}%
\newtoggle{CHEM}%
\newtoggle{ELEC}%
\newtoggle{ENG}%
\newtoggle{SCI}%
\newcommand*{\LogoSchool}{}%
\DeclareOption{arts}{%
  \toggletrue{ARTS}\togglefalse{BIZ}\togglefalse{CHEM}%
  \togglefalse{ELEC}\togglefalse{ENG}\togglefalse{SCI}%
  \renewcommand*{\LogoSchool}{arts}%
}%
\DeclareOption{biz}{%
  \togglefalse{ARTS}\toggletrue{BIZ}\togglefalse{CHEM}%
  \togglefalse{ELEC}\togglefalse{ENG}\togglefalse{SCI}%
  \renewcommand*{\LogoSchool}{biz}%
}%
\DeclareOption{chem}{%
  \togglefalse{ARTS}\togglefalse{BIZ}\toggletrue{CHEM}%
  \togglefalse{ELEC}\togglefalse{ENG}\togglefalse{SCI}%
  \renewcommand*{\LogoSchool}{chem}%
}%
\DeclareOption{elec}{%
  \togglefalse{ARTS}\togglefalse{BIZ}\togglefalse{CHEM}%
  \toggletrue{ELEC}\togglefalse{ENG}\togglefalse{SCI}%
  \renewcommand*{\LogoSchool}{elec}%
}%
\DeclareOption{eng}{%
  \togglefalse{ARTS}\togglefalse{BIZ}\togglefalse{CHEM}%
  \togglefalse{ELEC}\toggletrue{ENG}\togglefalse{SCI}%
  \renewcommand*{\LogoSchool}{eng}%
}%
\DeclareOption{sci}{%
  \togglefalse{ARTS}\togglefalse{BIZ}\togglefalse{CHEM}%
  \togglefalse{ELEC}\togglefalse{ENG}\toggletrue{SCI}%
  \renewcommand*{\LogoSchool}{sci}%
}%
%%
%% Font encoding support for iso-latin-1, utf-8 and ansinew (MiKTeX):
%% LC 26.9.2013
\newtoggle{UTF}%
\DeclareOption{latin1}{%
  \PassOptionsToPackage{latin1}{inputenc}%
}%
\DeclareOption{utf8}{%
  \PassOptionsToPackage{utf8}{inputenc}%
  \toggletrue{UTF}%
}%
\DeclareOption{ansinew}{%
  \PassOptionsToPackage{ansinew}{inputenc}%
}%
%
%%
%% PDF/A support extended from a-1b to a-2b. LC 17.4.2018
\newtoggle{PDFA}%
\newtoggle{writexmpdatafile}
\DeclareOption{a-1b}{%
  \toggletrue{PDFA}%
  \toggletrue{writexmpdatafile}%
  \PassOptionsToPackage{a-1b}{pdfx}%
}%
%
\DeclareOption{a-2b}{%
  \toggletrue{PDFA}%
  \toggletrue{writexmpdatafile}%
  \PassOptionsToPackage{a-2b}{pdfx}%
}%
%%
%
\DeclareOption{a-3b}{%
	\toggletrue{PDFA}%
	\toggletrue{writexmpdatafile}%
	\PassOptionsToPackage{a-3b}{pdfx}%
}%
%% Page layout switch
\newtoggle{ONLINE}%
\newtoggle{PRINT}
\DeclareOption{online}{%
  \toggletrue{ONLINE}%
  \togglefalse{PRINT}%
}%
\DeclareOption{print}{%
  \togglefalse{ONLINE}%
  \toggletrue{PRINT}%
}%
\DeclareOption*{%
  \PassOptionsToClass{\CurrentOption}{article}%
}%
\ExecuteOptions{english, utf8, online, a4paper}% Default package options
\ProcessOptions\relax%
%
\LoadClass{article}%
%
%% Load required packages
%
\iftoggle{PDFA}{%
%  \RequirePackage[latxmp, mathxmp]{pdfx}[2017/05/18]% Produces PDF/A 1b, 2b and 3b
  \RequirePackage{pdfx}[2024/06/24]% Produces PDF/A 1b, 2b and 3b
                                           % compliant pdf
  \RequirePackage{newfile}% Provides an easy interface for writing data into new
						  % file (used to write metadata into file .xmpdata)
}{%
  \AtEndPreamble{%
	\RequirePackage{hyperref}%
	\RequirePackage{hyperxmp}%
%	\iftoggle{UTF}{\hypersetup{pdfencoding=unicode}}{}%
  }%
}%
%
\AtEndPreamble{% Set up the hyperref options
  \iftoggle{UTF}{\hypersetup{pdfencoding=unicode}}{}%
  \hypersetup{pdfpagemode=UseNone, bookmarksnumbered=true}%
  \iftoggle{ONLINE}{%
  	\hypersetup{colorlinks=true, urlcolor=blue, linkcolor=blue, citecolor=blue}%
  }{%
  \iftoggle{PRINT}{%
%  	\hypersetup{colorlinks=false, urlcolor=black, linkcolor=black, citecolor=black}%
%	\hypersetup{colorlinks=false, linkbordercolor = {white}}%
	\hypersetup{hidelinks}%
  }{}%
  }%
}%
%
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
%%%%%%%%%% Load fonts
%% I resorted to this solution of using a macro in the preamble because:
%% 1. The order of loading the following five packages is important especially
%%    for multilingual documents. The loading order is i. font(s) ii. fontenc
%%    iii. inputenc and iv. babel. For a more elaborate explanation, see, e.g.,
%%    https://github.com/overleaf/overleaf/issues/579
%% 2. The newtx font packages must be loaded after the possible loading of ams 
%%    fonts, e.g. in amsthm, since newtxmath has substitutes for ams glyphs. In
%%    other words, the user must be able to load amsthm in the tex file using  
%%    \usepackage{amsthm} before newtxmath is loaded.
%%    A possibility would have been to load the packages using \EndPreamble or
%%    \AddToHook{begindocument/before}{\RequirePackage...}. Note here that 
%%    \AtBeginDocument shouldn't be used to load [font] packages to avoid 
%%    'timing' issues with e.g. hyperref or other packages that modify font 
%%    definitions or macros. Also, many packages test \AtBeginDocument whether
%%    a package has been loaded or not, and this test will fail if a package is
%%    loaded \AtBeginDocument.
%%    BUT...
%% 3. If desired by the user, packages like biblatex and csquotes must be loaded 
%%    after inputenc is loaded, so using \AtEndPreamble was not an option.
%% 4. I wanted the loaded fonts to be in the cls file and not in the tex file.
%% 5. I couldn't come up with any other solution.
%%
\newcommand*{\setupthesisfonts}{%
  \RequirePackage{newtxtext}% substitutes for ams glyphs
  \RequirePackage{newtxmath}% includes amsbsy & amsfonts symbols, don't load them
  \RequirePackage[T1]{fontenc}%
  \RequirePackage[utf8]{inputenc}% For scands in input of Finnish and English docs
 \RequirePackage{babel}%
}
%
%
\RequirePackage{calc}%
\RequirePackage{geometry}%
%\RequirePackage[kerning=true, spacing=true, babel=true, tracking=true,%	
%  protrusion=false]{microtype}%
\RequirePackage[babel=true, tracking=true,%	
protrusion=false]{microtype}%
\RequirePackage{fancyhdr}% For typsetting the cover- and abstract pages
\RequirePackage{sectsty}% Set section title fonts to sans serif
%\allsectionsfont{\usefont{T1}{phv}{b}{n}}
\allsectionsfont{\sffamily}%
%\RequirePackage{unicode-math}
\RequirePackage[labelfont={bf,sf}]{caption}% Format table and figure labels
\RequirePackage{chngcntr}%Allows counter dependencies to be changed for appendix
\RequirePackage{xurl}% Break long urls over lines. Loads url.sty.
%
%% Set up the logo
%% Note that BIZ and ARTS still (2012-08-17) use old logos as the
%% aaltologo-package is not up-to-date. Hence there are calls to ECON and TAIK
%% pic routines. 
%%%% REMOVED FORM USE. aaltologo.sty not maintained, logo has changed.
%\iftoggle{ARTS}{% 
%  \RequirePackage[TAIK, Uncoated]{aaltologo}%
%}{%
%\iftoggle{BIZ}{%
%  \RequirePackage[ECON, Uncoated]{aaltologo}%
%}{%
%\iftoggle{CHEM}{%
%  \RequirePackage[CHEM, Uncoated]{aaltologo}%
%}{%
%\iftoggle{ELEC}{%
%   \RequirePackage[ELEC, Uncoated]{aaltologo}%
%}{%
%\iftoggle{ENG}{%
%  \RequirePackage[ENG, Uncoated]{aaltologo}%
%}{%
%\iftoggle{SCI}{%
%  \RequirePackage[SCI, Uncoated]{aaltologo}%
%}{%
%\RequirePackage[Uncoated]{aaltologo}%
%}}}}}}%
%
%
%%%%%%% Set up the page layout %%%%%%%
%% First the horizontal dimensions %%
\iftoggle{ONLINE}{%
%  \setlength{\oddsidemargin}{8.6mm}% 1" + 8.6mm = 3.4cm
%  \setlength{\evensidemargin}{8.6mm}%
  \geometry{left=34mm, textwidth=142mm,%
	 top=37mm, textheight=230mm, headsep=20mm, heightrounded=true}%
}{%
\iftoggle{PRINT}{%}
  \geometry{left=48mm, textwidth=142mm,%
	 top=37mm, textheight=230mm, headsep=20mm, heightrounded=true}%
%  \setlength{\oddsidemargin}{17.6mm}% 4.3cm
%  \setlength{\evensidemargin}{-0.4mm}% 1" - 0.4mm = 2.5cm
}{}}%
%\setlength{\textwidth}{14.2cm}%
%
%% Then the vertical dimensions
%\setlength{\headsep}{12mm}%
%\setlength{\headheight}{1em}%
%\setlength{\topmargin}{-20mm}%
%\geometry{top=37mm, textheight=230mm, heightrounded=true}
%
%\setlength{\textheight}{23cm}%
%%
%% Set up the header and footer
\fancyhf{}% empty all default header and footer entries
\fancyheadoffset{0pt}%
\fancyhead[L]{\mbox{}\@@ltologo}% Add logo to cover and abstract pages
\cfoot{\thepage}% Place the page number 
\renewcommand{\headrulewidth}{0pt}%
%
%%%%%%% Float control %%%%%%%
\renewcommand{\floatpagefraction}{0.1}%
\renewcommand{\textfraction}{0.1}%
\renewcommand{\topfraction}{0.9}%
\renewcommand{\bottomfraction}{0.9}%
%
%%%%%% Now come all the macros used along with all the required counter, etc.
%
\newcommand*{\AbstractLang}{\MainLang}%
%
%%%%%%% Some shorthand %%%%%%%
\newcommand*{\IfEng}[3]{\ifdefstring{#1}{english}{#2}{#3}}%
\newcommand*{\IfFin}[3]{\ifdefstring{#1}{finnish}{#2}{#3}}%
\newcommand*{\IfSwe}[3]{\ifdefstring{#1}{swedish}{#2}{#3}}%
%
%%%%%%% Storage of number of pages and number of abstracts %%%%%%%
\newcounter{NAllPages}%
\newcounter{NMainTxtPages}%
\newcounter{NAppdxPages}%
% write in file .aux
\newcommand*{\stor@maintxtpag@number}{%
  \immediate\write\@auxout{\string\setcounter{NMainTxtPages}{\thepage-1}}%
}%
\AtEndDocument{%
  \immediate\write\@auxout{\string\setcounter{NAllPages}{\thepage}}%
}%
%
%
%%%%%% Language-specific definitions
%%%%%% First create the necessary 'variables'.
%%%%%%
\newcommand*{\thesiscontentsname}{}%
\newcommand*{\univ@rsity}{}%
\newcommand*{\sch@@l}{}%
\newcommand*{\@ddress}{}%
\newcommand*{\urln@me}{www.aalto.fi}%
%\newcommand*{\thesissupervisorname}{}%
%\newcommand*{\thesissuperadvisorname}{}%
%\newcommand*{\thesisadvisorname}{}%
%\newcommand*{\thesisadvisorsname}{}%
\newcommand{\coverdegprogramname}{}%
\newcommand{\coverdegreename}{}%
\newcommand*{\authorname}{}%
\newcommand*{\thesisname}{}%
\newcommand*{\collaborativepartnername}{}%
\newcommand*{\keywordsname}{}%
\newcommand*{\datename}{}%
\newcommand*{\langname}{}%
\newcommand*{\nofpgsname}{}%
\newcommand*{\supervisorname}{}%
\newcommand*{\advisorname}{}%
\newcommand*{\degprogramname}{}%
\newcommand*{\departmentname}{}%
\newcommand*{\degreeordep@rtmentname}{}%
\newcommand*{\degreeordep@rtment}{}%
\newcommand*{\majorname}{}%
\newcommand*{\codename}{}%
\newcommand*{\tocabstractname}{}%
%%
\newcommand*{\absheadname}{}%
\newcommand*{\tocabslang}{}%
%
%%%%%% Set up those values that can be set up automatically: university,
% school name, logo, etc.
%% Some can also be set explicitly by the user via macros like \university
%% and \school defined below after the language-specific stuff.
%%
\newcommand{\setthesismainlangnames}{%
  \IfEng{\MainLang}{%
    %% Cover page stuff in English
    \iftoggle{ARTS}{%
	  \renewcommand*{\sch@@l}{School of Arts, Design and Architecture}%
    }{%
    \iftoggle{BIZ}{%
      \renewcommand*{\sch@@l}{School of Business}%
    }{%
    \iftoggle{CHEM}{%
	  \renewcommand*{\sch@@l}{School of Chemical Engineering}%
    }{%
    \iftoggle{ELEC}{%
	  \renewcommand*{\sch@@l}{School of Electrical Engineering}%
    }{%
    \iftoggle{ENG}{%
	  \renewcommand*{\sch@@l}{School of Engineering}%
    }{%
    \iftoggle{SCI}{%
	  \renewcommand*{\sch@@l}{School of Science}%
    }{%
    \ifdefstring{\sch@@l}{}{%
	  \PackageError{aaltothesis}{%
		Your school isn't specified%
	  }{%
		Specify arts, biz, chem, elec eng or sci in \protect\documentclass{} %
		or specify it using \protect\school{}.%
	  }%
	}{}%
	}}}}}}%
%    \renewcommand*{\thesissupervisorname}{Supervisor}%
%    \renewcommand*{\thesissuperadvisorname}{Supervisor and advisor}%
%    \renewcommand*{\thesisadvisorname}{Advisor}%
%    \renewcommand*{\thesisadvisorsname}{Advisors}%
%
    \renewcommand{\coverdegprogramname}{%
	  \iftoggle{BSc}{%
 		Bachelor's Programme in \d@gpr@g%
	  }{%
	  \iftoggle{MSc}{%
		Master's Programme in \d@gpr@g%
 	  }{%
 	  \iftoggle{Lic}{%
		Doctoral Programme in \d@gpr@g%
	  }{}}}%
	}%
	\renewcommand{\coverdegreename}{
	  \iftoggle{BSc}{%
	  	Bachelor's Thesis%
	  }{%
	  \iftoggle{MSc}{%
	  	Master's Thesis%
	  }{%
	  \iftoggle{Lic}{%
	  	Licentiate Thesis%
	  }{}}}%
	}
%
	\renewcommand*{\tocabstractname}{Abstract}%
	\addto\captionsenglish{\renewcommand*{\contentsname}{Contents}}%
  }{% end if English
  \IfFin{\MainLang}{%
    %% Cover page stuff in Finnish
    \iftoggle{ARTS}{%
	  \renewcommand*{\sch@@l}{Taiteiden ja suunnittelun korkeakoulu}%
    }{%
    \iftoggle{BIZ}{%
	  \renewcommand*{\sch@@l}{Kauppakorkeakoulu}%
    }{%
    \iftoggle{CHEM}{%
	  \renewcommand*{\sch@@l}{Kemian tekniikan korkeakoulu}%
    }{%
    \iftoggle{ELEC}{%
	  \renewcommand*{\sch@@l}{S\"ahk\"otekniikan korkeakoulu}%
    }{%
    \iftoggle{ENG}{%
	  \renewcommand*{\sch@@l}{Insin\"o\"oritieteiden korkeakoulu}%
    }{%
    \iftoggle{SCI}{%
	  \renewcommand*{\sch@@l}{Perustieteiden korkeakoulu}%
    }{%
    \ifdefstring{\sch@@l}{}{%
      \PackageError{aaltothesis}{%
      	Your school isn't specified%
      }{%
        Specify arts, biz, chem, elec eng or sci in \protect\documentclass{} %
        or specify it using \protect\school{}.%
      }%
    }{}%
	}}}}}}%
%
%    \renewcommand*{\thesissupervisorname}{%
%      \iftoggle{BSc}{Vastuuopettaja}{Ty\"on valvoja}%
%    }%
%    \renewcommand*{\thesissuperadvisorname}{%
%      \iftoggle{BSc}{%
%	    Vastuuopettaja ja ohjaaja%
%	  }{%
%	    Ty\"on valvoja ja ohjaaja%
%	  }%
%    }%
%    \renewcommand*{\thesisadvisorname}{Ty\"on ohjaaja}%
%    \renewcommand*{\thesisadvisorsname}{Ty\"on ohjaajat}%
%%
	\renewcommand{\coverdegprogramname}{%
	  \iftoggle{BSc}{%
		\d@gpr@g{} kandidaattiohjelma%
	  }{%
	  \iftoggle{MSc}{%
		\d@gpr@g{} maisteriohjelma%
	  }{%
	  \iftoggle{Lic}{%
		\d@gpr@g{} tohtoriohjelma%
	  }{}}}%
	}%
	\renewcommand{\coverdegreename}{
		\iftoggle{BSc}{%
			Kandidaatin tutkielma%
		}{%
		\iftoggle{MSc}{%
		  \ifboolexpr{ togl{ARTS} or togl{BIZ} }{Pro gradu}{Diplomity\"o}
		}{%
		\iftoggle{Lic}{%
			Lisensiaatin ty\"o%
		}{}%
		}}%
	}%
%
    \renewcommand*{\tocabstractname}{Tiivistelm\"a}%
	\addto\captionsfinnish{\renewcommand*{\contentsname}{Sis\"allysluettelo}}%
  }{% end if Finnish
  \IfSwe{\MainLang}{%
    %% Cover page stuff in Swedish
    \iftoggle{ARTS}{%
	  \renewcommand*{\sch@@l}{H\"ogskolan f\"or konst, design och arkitektur}%
    }{%
    \iftoggle{BIZ}{%
	  \renewcommand*{\sch@@l}{Handelsh\"ogskolan}%
    }{%
    \iftoggle{CHEM}{%
	  \renewcommand*{\sch@@l}{H\"ogskolan f\"or kemiteknik}%
    }{%
    \iftoggle{ELEC}{%
	  \renewcommand*{\sch@@l}{H\"ogskolan f\"or elektroteknik}%
    }{%
    \iftoggle{ENG}{%
	  \renewcommand*{\sch@@l}{H\"ogskolan f\"or ingenj\"orsvetenskaper}%
    }{%
    \iftoggle{SCI}{%
	  \renewcommand*{\sch@@l}{H\"ogskolan f\"or teknikvetenskaper}%
    }{%
    \ifdefstring{\sch@@l}{}{%
	  \PackageError{aaltothesis}{%
		Your school isn't specified%
	}{%
	  Specify arts, biz, chem, elec eng or sci in \protect\documentclass{} %
	  or specify it using \protect\school{}.%
	}%
	}{}%
	}}}}}}%
%
%    \renewcommand*{\thesissupervisorname}{%
%      \iftoggle{BSc}{%
%      	 Ansvarsl\"arare%
%      }{%
%        \"Overvakare%
%      }%
%    }%
%    \renewcommand*{\thesissuperadvisorname}{%
%      \iftoggle{BSc}{%
%        Ansvarsl\"arare och handledare%
%      }{%
%        Arbetets \"overvakare och handledare%
%      }%
%    }%
%    \renewcommand*{\thesisadvisorname}{Handledare}%
%    \renewcommand*{\thesisadvisorsname}{Handledare}%
%%
	\renewcommand{\coverdegprogramname}{%
	  \iftoggle{BSc}{%
		Kandidatprogrammet i \d@gpr@g%
	  }{%
	  \iftoggle{MSc}{%
		Magisterprogrammmet i \d@gpr@g%
	  }{%
	  \iftoggle{Lic}{%
		Doktorandprogrammet i \MakeLowercase\d@gpr@g%
	  }{}}}%
	}%
%
	\renewcommand{\coverdegreename}{
	  \iftoggle{BSc}{%
		Kandidatarbete%
	  }{%
		\iftoggle{MSc}{%
		  \iftoggle{ARTS}{Magisterarbete}{%
			\iftoggle{BIZ}{Magisterarbete}{%
				Diplomarbete%
		  }}%
		}{%
		  \iftoggle{Lic}{%
			Licentiatavhandling%
		  }{}%
		}}%
	}%
%
    \renewcommand*{\tocabstractname}{Sammandrag}%
    \addto\captionsswedish{\renewcommand*{\contentsname}{Inneh\aa{}llsf\"orteckning}}%
  }{% end if Swedish
  }}}% Close the else branch of all three languages
}%
%
\newcommand*{\setabstractlangnames}{%
% Define the the headers, the names of fields in the language of the abstract,
% and set up some lengths used in the abstract.
 \IfEng{\AbstractLang}{%
   %% Abstract header and field names in English
   \renewcommand*{\univ@rsity}{Aalto University}%
   \renewcommand*{\@ddress}{\univ@rsity, P.O. BOX 11000, 00076 AALTO}
   \renewcommand*{\authorname}{Author}%
   \renewcommand*{\thesisname}{Title}%
   \renewcommand*{\abstractname}{Abstract}%
   \renewcommand*{\collaborativepartnername}{Collaborative partner}%
   \renewcommand*{\keywordsname}{Keywords}%
   \renewcommand*{\datename}{%
	 \iftoggle{Lic}{Date of acceptance}{Date}
   	}%
   \renewcommand*{\langname}{Language}%
   \renewcommand*{\nofpgsname}{Number of pages}%
   \renewcommand*{\supervisorname}{%
     \ifnumequal{\value{advisors}}{0}{% No thesis advisor
       \iftoggle{BSc}{%
%		 Teacher in charge and advisor%
		 Thesis supervisor and advisor%
	   }{%
	   \iftoggle{MSc}{%
		 Thesis supervisor and advisor%
	   }{%
	   \iftoggle{Lic}{%
	   	 Supervising professor and thesis advisor%
	   }{}%
	   }}%
     }{% Supervisor and advisor(s)
       \iftoggle{BSc}{%
%		 Teacher in charge%
		 Thesis supervisor%
	   }{%
	   \iftoggle{MSc}{%
		 Thesis supervisor%
	   }{%
	   \iftoggle{Lic}{%
	   	 Supervising professor%
	   }{}%
	   }}%
    }%
   }%
   \renewcommand*{\advisorname}{%
     \ifnumequal{\value{advisors}}{0}{}{%
     \ifnumequal{\value{advisors}}{1}{%
       \iftoggle{Lic}{%
       	 Thesis advisor%
       }{%
		 Thesis advisor%
	   }%
	 }{%
     \ifnumgreater{\value{advisors}}{1}{%
       \iftoggle{Lic}{%
     	 Thesis advisors%
       }{%
     	 Thesis advisors%
       }%
     }{%
     }}}%%%
   }%
   %
   \renewcommand*{\degprogramname}{%
   	 \iftoggle{Lic}{Doctoral programme in}{Degree programme}%
   }%
   \renewcommand*{\departmentname}{Department}%
   %
   \renewcommand*{\majorname}{Major}%
   \renewcommand*{\codename}{Code of major}%
   \iftoggle{BSc}{%
     \renewcommand*{\absheadname}{Abstract of the bachelor's thesis}%
   }{%
   \iftoggle{MSc}{%
     \renewcommand*{\absheadname}{Abstract of the master's thesis}%
   }{%
   \iftoggle{Lic}{%
     \renewcommand*{\absheadname}{Abstract of the licentiate's thesis}%
   }{}}}%
 }{% end if English
 \IfFin{\AbstractLang}{%
   %% Abstract header and field names in Finnish
   \renewcommand*{\univ@rsity}{Aalto-yliopisto}%
   \renewcommand*{\@ddress}{\univ@rsity, PL 11000, 00076 AALTO}
   \renewcommand*{\authorname}{Tekij\"a}%
   \renewcommand*{\thesisname}{Ty\"on nimi}%
   \renewcommand*{\abstractname}{Tiivistelm\"a}%
   \renewcommand*{\collaborativepartnername}{Yhteisty\"otaho}%
   \renewcommand*{\keywordsname}{Avainsanat}%
   \renewcommand*{\datename}{%
	 \iftoggle{Lic}{Hyv\"aksymisp\"aiv\"am\"a\"ar\"a}{P\"aiv\"am\"a\"ar\"a}
   	}%
   \renewcommand*{\langname}{Kieli}%
   \renewcommand*{\nofpgsname}{Sivum\"a\"ar\"a}%
   \renewcommand*{\supervisorname}{%
     \ifnumequal{\value{advisors}}{0}{%
       \iftoggle{BSc}{%
%         Vastuuopettaja ja ohjaaja%
         Valvoja ja ohjaaja%
       }{%
       \iftoggle{MSc}{%
         Valvoja ja ohjaaja%
       }{%
       \iftoggle{Lic}{%
       	 Vastuuprofessori ja ohjaaja%
       }{}%
       }}%
     }{%
       \iftoggle{BSc}{%
%       	 Vastuuopettaja%
          Valvoja%
        }{%
        \iftoggle{MSc}{%
          Valvoja%
        }{%
          Vastuuprofessori%
        }}%
     }%
   }%
   \renewcommand*{\advisorname}{%
     \ifnumequal{\value{advisors}}{0}{}{%
       \ifnumequal{\value{advisors}}{1}{%
       	 \iftoggle{Lic}{%
       	 	Ohjaaja%
       	 }{%
			Ohjaaja%
		}}{%
       \ifnumgreater{\value{advisors}}{1}{%
       	 \iftoggle{Lic}{%
       	   Ohjaajat%
       	 }{%
       	   Ohjaajat%
         }%
       }{%
     }}}%%%
   }%
   \renewcommand*{\degprogramname}{%
   	\iftoggle{Lic}{Tohtoriohjelma}{Koulutusohjelma}%
   }%
   \renewcommand*{\departmentname}{Laitos}%
   \renewcommand*{\majorname}{P\"a\"aaine}%
   \renewcommand*{\codename}{P\"a\"aaineen koodi}%
   \iftoggle{BSc}{%
     \renewcommand*{\absheadname}{Tekniikan kandidaatinty\"on tiivistelm\"a}%
   }{%
   \iftoggle{MSc}{%
     \renewcommand*{\absheadname}{Diplomity\"on tiivistelm\"a}%
   }{%
   \iftoggle{Lic}{%
     \renewcommand*{\absheadname}{Lisensiaatintutkimuksen tiivistelm\"a}%
   }{}}}%
 }{% end if Finnish
 \IfSwe{\AbstractLang}{%
   %% Abstract header and field names in Swedish
   \renewcommand*{\univ@rsity}{Aalto-universitetet}%
   \renewcommand*{\@ddress}{\univ@rsity, PB 11000, 00076 AALTO}%
   \renewcommand*{\authorname}{F\"orfattare}%
   \renewcommand*{\thesisname}{Titel}%
   \renewcommand*{\abstractname}{Sammandrag}%
   \renewcommand*{\collaborativepartnername}{Samarbetspartner}%
   \renewcommand*{\keywordsname}{Nyckelord}%
   \renewcommand*{\datename}{Datum}%
   \renewcommand*{\langname}{Spr\r{a}k}%
   \renewcommand*{\nofpgsname}{Sidantal}%
   \renewcommand*{\supervisorname}{%
     \ifnumequal{\value{advisors}}{0}{%
       \iftoggle{BSc}{%
%         Ansvarsl\"arare%
         \"Overvakare och handledare%
       }{%
       \iftoggle{MSc}{%
         \"Overvakare och handledare%
       }{%
       \iftoggle{Lic}{%
       	Ansvarsprofessor och handledare%
       }{}%
       }}%
     }{%
       \iftoggle{BSc}{%
%       	 Ansvarsl\"arare%
         \"Overvakare%
       }{%
       \iftoggle{MSc}{%
         \"Overvakare%
       }{%
       \iftoggle{Lic}{%
       	 Ansvarsprofessor%
       }{}
   	   }}%
     }%
   }%
   \renewcommand*{\advisorname}{%
     \ifnumequal{\value{advisors}}{0}{}{%
       \ifnumequal{\value{advisors}}{1}{Handledare}{%
         \ifnumgreater{\value{advisors}}{1}{Handledare}{%
     }}}%%%
   }%
   \renewcommand*{\degprogramname}{%
   	 \iftoggle{Lic}{Doktorandprogrammet i}{Utbildningsprogram}%
   }%
   \renewcommand*{\departmentname}{Institution}%
   \renewcommand*{\majorname}{Huvud\"amne}%
   \renewcommand*{\codename}{Huvud\"amnets kod}%
   \iftoggle{BSc}{%
     \renewcommand*{\absheadname}{Sammandrag av kandidatarbetet}%
   }{%
   \iftoggle{MSc}{%
     \renewcommand*{\absheadname}{Sammandrag av diplomarbetet}%
   }{%
   \iftoggle{Lic}{%
     \renewcommand*{\absheadname}{Sammandrag av licentiatavhandlingen}{}%
   }{}}}%
 }{% end if Swedish
 }}}% Close the else branch of all three languages
%
 \iftoggle{BSc}{%
   \renewcommand*{\degreeordep@rtmentname}{\degprogramname}%
   \renewcommand*{\degreeordep@rtment}{\d@gpr@g}% \d@gpr@g is set in \degreeprogram
 }{%
   \renewcommand*{\degreeordep@rtmentname}{\degprogramname}%
   \renewcommand*{\degreeordep@rtment}{\d@gpr@g}% \d@gpr@g is set in \degreeprogram
 }%
}%
%
\newcommand*{\L@ng}[1]{% internal macro:
% Determine the language of the thesis (\MainLang) provided by the user in the
% \documentclass options and write it into the abstract in the appropriate field
% field in the language of the current abstract. The abstract language is
% the parameter of this macro, and it is provided by the user in the abstract
% environment.
  \ifstrequal{#1}{english}{%
    \IfEng{\MainLang}{English}{%
    \IfFin{\MainLang}{Finnish}{%
    \IfSwe{\MainLang}{Swedish}{%
    }}}%
  }{%
  \ifstrequal{#1}{finnish}{%
    \IfEng{\MainLang}{englanti}{%
    \IfFin{\MainLang}{suomi}{%
    \IfSwe{\MainLang}{ruotsi}{%
    }}}%
  }{%
  \ifstrequal{#1}{swedish}{%
    \IfEng{\MainLang}{engelska}{%
    \IfFin{\MainLang}{finska}{%
    \IfSwe{\MainLang}{svenska}{%
    }}}%
  }{%
  }}}%
}%
%
\newcommand{\settocabslang}{% internal macro:
% Sets value of \tocabslang, the extra text that goes into the toc when there
% are more abstracts than one. The value of \tocabslang has to be set explicitly
% prior to use, since it is used in \addcontentsline in the abstractpage
% environment, and so it may not contain any \if* commands. Thus making
% \tocabslang decide with an \if* results in an error since it is part of the
% argument of \addcontentsline.
  \ifdefstrequal{\MainLang}{\AbstractLang}{%
    \renewcommand*{\tocabslang}{}%
  }{%
    \IfEng{\MainLang}{%
      \IfFin{\AbstractLang}{%
      	\renewcommand*{\tocabslang}{(in Finnish)}%
      }{%
      \IfSwe{\AbstractLang}{%
      	\renewcommand*{\tocabslang}{(in Swedish)}%
      }{%
        \PackageError{aaltothesis}{%
          Gosh! You are in dark waters! \protect\settocabslang (1)%
		}{%
		  Perhaps you must correct all previous errors. May the force be with you.%
	    }%
      }}%
    }{%
    \IfFin{\MainLang}{%
      \IfEng{\AbstractLang}{%
      	\renewcommand*{\tocabslang}{(englanniksi)}%
      }{%
      \IfSwe{\AbstractLang}{%
      	\renewcommand*{\tocabslang}{(ruotsiksi)}%
      }{%
        \PackageError{aaltothesis}{%
          Gosh! You are in dark waters! \protect\settocabslang (2)%
        }{%
		  Perhaps you must correct all previous errors. May the force be with you.%
	    }%
      }}%
    }{%
    \IfSwe{\MainLang}{%
      \IfEng{\AbstractLang}{%
      	\renewcommand*{\tocabslang}{(p\aa{} engelska)}%
      }{%
      \IfFin{\AbstractLang}{%
      	\renewcommand*{\tocabslang}{(p\aa{} finska)}%
      }{%
		\PackageError{aaltothesis}{%
		  Gosh! You are in dark waters! \protect\settocabslang (3)%
	    }{%
		  Perhaps you must correct all previous errors. May the force be with you.%
	    }%
      }}%
    }{%
      \PackageError{aaltothesis}{%
		Gosh! You should not have got this far. \protect\settocabslang (4)%
      }{%
		Perhaps you must correct all previous errors. May the force be with you.%
      }%
    }}}%
  }%
}%
%
%% This ends the definitions of language-specific variables
%
\AtEndPreamble{%
  \ifboolexpr{ togl {BSc} or togl {MSc} or togl {Lic} }{%
	\setthesismainlangnames%
	\setabstractlangnames%
  }{%
	\PackageError{aaltothesis}{%
	  \protect\univdegree{} is not specified%
	}{%
	  Specify BSc, MSc or Lic in \protect\univdegree{}.%
	}%
  }%
}%
%
%%%%%% Interface commands: parameters specified by user (+ necessary variables).
%% Some have been automatically set up in the language-specific part but can
%% be overrun by the user via these macros.
%% First the straightforward ones:
%
\newcommand*{\ThesisAuthor}{}% variable
\newcommand*{\thesisauthor}[1]{\renewcommand*{\ThesisAuthor}{#1}}% User command
%
\newcommand{\th@sistitl@}{}% variable
\newcommand*{\pdfth@sistitl@}{}% variable
\newcommand{\thesistitle}[2][]{% User command
  \renewcommand{\th@sistitl@}{#2}%
  \ifstrempty{#1}{%
	\renewcommand*{\pdfth@sistitl@}{#2}%
  }{%
	\renewcommand*{\pdfth@sistitl@}{#1}%
  }%
}%
%
\newcommand{\th@sissubtitl@}{}% variable
\newcommand*{\pdfth@sissubtitl@}{}% variable
\newcommand{\thesissubtitle}[2][]{% User command
  \renewcommand{\th@sissubtitl@}{#2}%
  \ifstrempty{#1}{%
	\renewcommand*{\pdfth@sissubtitl@}{#2}%
  }{%
	\renewcommand*{\pdfth@sissubtitl@}{#1}%
  }%
}%
%
\newcommand*{\titlesepmark}{ --- }%
\newcommand*{\@bstr@ctthesistitle}{%
  \ifdefvoid{\th@sistitl@}{%
  	\PackageError{aaltothesis}{You haven't given \protect\thesistitle}%
  	{Specify \protect\thesistitle.}%
  }{%
  	\ifdefvoid{\th@sissubtitl@}{\th@sistitl@}%
  	{%
  	 \th@sistitl@{}\titlesepmark{}\th@sissubtitl@{}%
   }%
  }%
}%
%
\newcommand*{\coll@bp@rtner}{}%
\newcommand*{\collaborativepartner}[1]{%
  \renewcommand{\coll@bp@rtner}{#1}%
}%
%
\newcommand*{\D@te}{}% variable
\renewcommand*{\date}[1]{\renewcommand*{\D@te}{#1}}% User command
%
\newcommand*{\pl@ce}{}% variable
\newcommand*{\place}[1]{\renewcommand*{\pl@ce}{#1}}% User command
%
\newcommand*{\dateandplace}{\pl@ce{} \D@te{}}% Internal macro
%
%\newcommand*{\university}[1]{\renewcommand*{\univ@rsity}{#1}}% User command
%
\newcommand*{\school}[1]{\renewcommand*{\sch@@l}{#1}}% User command
%
\newcommand*{\d@gpr@g}{}% variable
\newcommand*{\degreeprogram}[1]{\renewcommand*{\d@gpr@g}{#1}}% User command
%
\newcommand*{\sup@rvis@r}{}% variable
\newcommand*{\supervisor}[1]{\renewcommand*{\sup@rvis@r}{#1}}% User command
%
% User interface for the logo
\newcommand*{\@@ltologo}{}% variable
\newcommand*{\@@ltoabslogo}{}% variable
\newcommand*{\LogoFile}{}% variable
\newcommand*{\LogoMark}{}% variable
\newcommand{\uselogo}[1]{%
% Allowed arguments: ! | ? | ' | aalto! | aalto?  | aalto' | <empty>
% Build the logo file name:
% the default is the school (arts|biz|chem|elec|eng|sci) in \LogoSchool set
% earlier in the class options, followed the mark !|?|' in \LogoMark set here,
% and the language (en|fi|sv) in \LogoLang set earlier in the class options.
% Alternatively the user can use the aalto logo by specifying aalto!|aalto?|aalto'
% First, determine the punctuation mark in the logo:
  \ifblank{#1}{\empty}{%
	\ifstrequal{#1}{!}{%
	  \renewcommand*{\LogoMark}{-exclm-}%
	}{%
	\ifstrequal{#1}{?}{%
	  \renewcommand*{\LogoMark}{-quest-}%
	}{%
	\ifstrequal{#1}{'}{%
	  \renewcommand*{\LogoMark}{-quote-}%
	}{%
	\ifstrequal{#1}{aalto!}{%
	  \renewcommand*{\LogoSchool}{aalto}%
	  \renewcommand*{\LogoMark}{-exclm}%
	  \renewcommand*{\LogoLang}{}%
	}{
	\ifstrequal{#1}{aalto?}{%
	  \renewcommand*{\LogoSchool}{aalto}%
	  \renewcommand*{\LogoMark}{-quest}%
	  \renewcommand*{\LogoLang}{}%
	}{
	\ifstrequal{#1}{aalto'}{%
	  \renewcommand*{\LogoSchool}{aalto}%
	  \renewcommand*{\LogoMark}{-quote}%
	  \renewcommand*{\LogoLang}{}%
	}{%
	\PackageError{aaltothesis}{%
		Only !, ?, ', aalto!, aalto?, aalto' are allowed. Otherwise leave the field empty%
		}{%
		Use !, ?, ', aalto!, aalto?, aalto' or leave the field empty.%
		}%
	}}}}}}%
	\renewcommand*{\LogoFile}{\LogoSchool\LogoMark\LogoLang.pdf}%
	% Pass on the logo file name to \includegraphics
	\renewcommand*{\@@ltologo}{\includegraphics[trim=19 16 19 19, clip, height=11mm]{logos/\LogoFile}}% for the cover
  %\gdef\AaltoLogoSchool{}% Contains school name. Set to empty to remove it.
%  \renewcommand*{\@@ltologo}{\AaltoLogoSmall{0.77}{#1}{black}}% for the cover
%  \renewcommand*{\@@ltoabslogo}{\AaltoLogoSmall{0.77}{#1}{black}}% for the abstract page
  }% End \ifblank
}% End \uselogo
%
\newcommand*{\m@jor}{}% variable
\newcommand*{\major}[1]{\renewcommand*{\m@jor}{#1}}%
% User commands for M.Sc. and Lic. only
%\newcommand*{\professorship}[1]{\renewcommand*{\m@jor}{#1}}%
%
\newcommand*{\Cod@}{}% variable
\newcommand*{\code}[1]{\renewcommand{\Cod@}{#1}}% User command
%
\newcommand*{\dep@rtment}{}% variable
\newcommand*{\department}[1]{\renewcommand*{\dep@rtment}{#1}}% User command
%
% Then come the more complex macros:
% First some boolean flags
\newtoggle{BSc}% default is false
\newtoggle{MSc}%
\newtoggle{Lic}%
\newcommand*{\univdegree}[1]{% User command
  \ifstrequal{#1}{BSc}{%
    \toggletrue{BSc}\togglefalse{MSc}\togglefalse{Lic}%
  }{%
  \ifstrequal{#1}{MSc}{%
    \togglefalse{BSc}\toggletrue{MSc}\togglefalse{Lic}%
  }{%
  \ifstrequal{#1}{Lic}{%
    \togglefalse{BSc}\togglefalse{MSc}\toggletrue{Lic}%
  }{%
    \PackageError{aaltothesis}{%
	  Only BSc, MSc or Lic is allowed as parameter for degree%
	}{%
	  Use BSc, MSc or Lic.%
    }%
  }}}%
}%
%
\newcounter{advisors}%
\newcommand*{\advis@rA}{}%
\newcommand*{\advis@rB}{}%
\newcommand*{\advisor}[1]{% User command
  \stepcounter{advisors}%
  \ifnumequal{\value{advisors}}{1}{%
    \renewcommand*{\advis@rA}{#1}%
  }{%
  \ifnumequal{\value{advisors}}{2}{%
    \renewcommand*{\advis@rB}{#1}%
  }{%
    \PackageError{aaltothesis}{%
      Only 2 advisors are allowed%
	}{%
	  Give at most 2 advisors or hack the code.
    }%
  }}%
}%
\newcommand*{\Advis@r}[1]{% internal macro
  \ifstrequal{#1}{1}{% One advisor
    \advis@rA{}%
  }{%
  \ifstrequal{#1}{2}{% Two advisors
    \advis@rB{}%
  }{%
    \PackageError{aaltothesis}{%
      Only 2 advisors are allowed%
    }{%
      Give at most 2 advisors or hack the code.%
    }%
  }}%
}%
%
%%
%% Two cover-related internal macros (No longer used. LC)
%%
%\newcommand*{\cov@rsup@rvisor}{%
%%  \ifdefstrequal{\sup@rvis@r}{\advis@rA}{% same supervisor & advisor
%%    \global\defcounter{advisors}{0}%
%%    \thesissuperadvisorname%
%%  }{%
%%    \thesissupervisorname%
%%  }%
%  \ifnumequal{\value{advisors}}{0}{%
%  	\thesissuperadvisorname%
%  }{%
%    \thesissupervisorname%
%  }%
%}%
%
%\newcommand*{\cov@radvisor}{%
%  \ifnumequal{\value{advisors}}{0}{%
%  }{%
%  \ifnumequal{\value{advisors}}{1}{%
%	\thesisadvisorname%
%  }{%
%  \ifnumgreater{\value{advisors}}{1}{%
%	\thesisadvisorsname%
%  }{%
%	\PackageError{aaltothesis}{%
%	  Uh oh! You should never have got here (\protect\cov@radvisor).%
%    }{%
%      You're in dark waters now...
%    }%
%  }}}%
%}%
%
%%
%% Interface for copyright text
%%
\newcommand{\CopyrightText}{}% variable; used for printing on page
\newcommand{\MetaCopyrightText}{}%
\newcommand{\pdfCopyrightURL}{}%
\newcommand{\copyrighttext}[2]{%
  \renewcommand{\MetaCopyrightText}{#1}%
  \renewcommand{\CopyrightText}{#2}%
  \ifdef{\doclicenseURL}{\renewcommand{\pdfCopyrightURL}{\doclicenseURL}}{}%
}%
%
%%
%%
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
%%%%%%%%%%%%%%%% Do the cover page layout %%%%%%%%%%%%%%%%
\pagenumbering{arabic}%
\newlength{\coverpageindent}%
\setlength{\coverpageindent}{10mm}%
\newlength{\coverindent}%
\setlength{\coverindent}{48mm}%
\newlength{\auxwidth}%
\newcommand{\mytextsf}[1]{%
%  {\usefont{T1}{phv}{b}{n}\fontsize{11}{13.2}\selectfont{#1}}%
  {\sffamily\normalsize\textbf{#1}}%
}%
\newcommand{\makecoverpage}{%
  \iftoggle{ONLINE}{%
%	\newgeometry{top=58.5mm, bottom=25mm, left=20mm, right=20mm, headheight=21mm,%
%  	 headsep=29mm}%
	\newgeometry{top=37mm, bottom=25mm, left=20mm, right=20mm, headsep=20mm}%
  }{%
  \iftoggle{PRINT}{%
	\newgeometry{top=37mm, bottom=25mm, left=27mm, right=13mm, headsep=20mm}%
  }{}%
  }%
%  \lhead{\@@ltologo\\[7em]\noindent\textsf{\coverdegprogramname}}%
  %\lhead{\mbox{}\@@ltologo}%
%  \fancyhead[L]{\mbox{}\@@ltologo}%
  \cfoot{}%
  \thispagestyle{fancy}%
%\vspace*{-52.5mm}%
%\noindent%
%\mbox{\@@ltoabslogo}\par%
%\vspace*{7em}%
%\noindent%
%\textsf{\coverdegprogramname}\par%
%\vspace*{10mm}%
%\noindent%
\vspace*{2\baselineskip}%
\noindent%
\textsf{\coverdegprogramname}\par\vspace{10mm}\noindent%
  {\sffamily%
   \renewcommand{\headrulewidth}{0pt}
   \vspace*{\baselineskip}%
   \noindent% Position the title and author
  % The title and author, each in their own box, are placed in an enclosing
  % box with its height limited so as to 
  % 1. fix the position of the text that follows on the page and
  % 2. to prevent unnecessarily long titles.
  % The vertical space for the title is 120pt, followed by a 6-mm blank
  % space, and the author's name is typeset in a 12-pt high font.
   \parbox[t][132pt+6mm]{0.75\textwidth-\coverpageindent}{%
  	%\usefont{T1}{phv}{b}{n}%
	 \noindent% First position the title
	 \parbox[t]{\textwidth-\coverpageindent}{%
	  \raggedright%
	  {\Huge\selectfont\th@sistitl@}\par% title
	   \ifdefvoid{\th@sissubtitl@}{}{% subtitle is specified
		 \vspace{1.5\baselineskip}%
	  	 \large\selectfont\th@sissubtitl@}% subtitle
	  }\par%
	 \vspace{0.72\baselineskip}%
	 \rule{\textwidth}{1.75pt}\par%
	 \vspace{\baselineskip}%
	 \noindent% followed by the author
	 \parbox{\textwidth-\coverpageindent}{%
	   \large\textbf{\ThesisAuthor}}\par%
   }\par%
   \vfill%
   \settowidth{\auxwidth}{\coverdegreename}%
   {\setlength{\arrayrulewidth}{1.75pt}% Change line width of vertical line (affects all table line widths, so must be put into braced to keep change local)
    \hfill\begin{tabular}{|p{\auxwidth}@{}}%
    	\coverdegreename\\%
    	\number\year%
    \end{tabular}}%
   \clearpage%
   \pagestyle{plain}%
%   \pagestyle{myheadings}%
  }%
  \restoregeometry%
}%
%
%%%%%%%%%%%%%% End of the cover page layout %%%%%%%%%%%%%%
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
%
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
%%%%%%%%%%%%%% The copyright page %%%%%%%%%%%%%%
\newcommand{\makecopyrightpage}{%
  \thispagestyle{empty}%
%  \vspace*{-25mm}%
%  \noindent%
%  \mbox{\@@ltoabslogo}\par% this is the logo
%  \vspace*{25mm}%
  \noindent%
  \CopyrightText\par%
  \clearpage%
}%
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
%
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
%%%%%%%%%%%%%%% Abstract stuff begins here %%%%%%%%%%%%%%%
%% First some lengths and internal macros
\newlength{\absheadlen}% Used to set width of 2nd column of the abstract header,
% this width is set above according to the respective text width
\newlength{\abstractwidth}%
\AtBeginDocument{\setlength{\abstractwidth}{\textwidth}}%
\newlength{\rowsep}%
\setlength{\rowsep}{-1.3\columnsep}%
\newlength{\keywdparheight}%
\setlength{\keywdparheight}{3\baselineskip}%s
\newlength{\fnamelenA}%
\newlength{\fnamelenB}%
\newlength{\ftextlen}%
%
% the line across the abstract page (with space around it)
\newcommand*{\@bsbre@k}{%
%  \vspace{2.5pt}\hrule\vspace{0.5pt}%
  \vspace{3pt}\hrule\vspace{5pt}%
}%
% two boxes, one for the field name and the other for the content
\newcommand{\@bsfield}[3][]{%
  \settowidth{\auxwidth}{\mytextsf{#2}}%
  \noindent%
  \parbox[t][#1]{\auxwidth}{\mytextsf{#2}}%
  \hspace{1ex}%
  \parbox[t][#1]{\abstractwidth-\auxwidth-1ex}{\raggedright#3}%
  \@bsbre@k%
}%
%
\newcommand*{\shownumberofpages}{%
%  \ifthenelse{\value{NMainTxtPages}=0}{\arabic{NAllPages}}%
  \ifnumequal{\value{NMainTxtPages}}{0}{\arabic{NAllPages}}%
 	{\arabic{NMainTxtPages}+\arabic{NAppdxPages}}%
}%
%
\newcommand{\k@ywords}{}%
\newcommand{\keywords}[1]{\renewcommand*{\k@ywords}{#1}}%
%
%% The macro to contain the abstract text so that it can be added to the
%% metadata in the xmpdata file
\newcommand{\abstracttext}{}%
\newcommand{\thesisabstract}[1]{\renewcommand{\abstracttext}{#1}}%
\newcommand*{\spc}{\noexpand\sep}%
%
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
%%%%%%%%%%%%%%%%%%%%%%%%%%% The abstract page layout %%%%%%%%%%%%%%%%%%%%%%%%%%%
\newenvironment{abstractpage}[1][\MainLang]{%
  \ifstrequal{#1}{english}{%
  	\renewcommand*{\AbstractLang}{english}%
  }{%
  \ifstrequal{#1}{finnish}{%
  	\renewcommand*{\AbstractLang}{finnish}%
  }{%
  \ifstrequal{#1}{swedish}{%
  	\renewcommand*{\AbstractLang}{swedish}%
  }{%
    \PackageError{aaltothesis}{%
      Only english, finnish or swedish is allowed as optional parameter%
    }{%
      Use english, finnish or swedish.%
    }%
  }}}%
  \selectlanguage{\AbstractLang}%
  \clearpage%
  \renewcommand{\headrulewidth}{0pt}%
  \thispagestyle{fancy}%
  \setabstractlangnames%
  \settowidth{\absheadlen}{\@ddress}%
  \settowidth{\fnamelenA}{\mytextsf{\majorname}}%
  \settowidth{\fnamelenB}{\mytextsf{\codename}}%
  \settowidth{\ftextlen}{\Cod@}%
  \phantomsection%
  \settocabslang%
  \addcontentsline{toc}{section}{\tocabstractname{} \tocabslang}%
  \renewcommand*{\spc}{, }
  \setcounter{NAppdxPages}{\value{NAllPages}-\value{NMainTxtPages}}% no. of pages in appendix
%  \thispagestyle{empty}%
%  \enlargethispage{5mm}%
%  \vspace*{-20mm}%
  \noindent%
% First the header, i.e. the logo, of the abstract page
%  \begin{tabular}{@{}p{\textwidth}@{}}%
%	\mbox{}\par\vspace*{-0.75em}
%%  {\mbox{\selectlanguage{\AbstractLang}\@@ltoabslogo}}% this is the logo
 %\mbox{  \selectlanguage{#1}
 %	\AaltoLogoSmall{0.77}{!}{black}}
%  \end{tabular}%
%\lhead{\selectlanguage{\AbstractLang}\mbox{}\@@ltologo}%
  \fancyhead[L]{\selectlanguage{\AbstractLang}\mbox{}\@@ltologo}%
  \cfoot{}%
  \par\vspace{3em}%
%% Then the abstract form
  \noindent%
  \hrule\vspace{5pt}%
  \@bsfield{\authorname}{\ThesisAuthor}%
  \@bsfield{\thesisname}{\@bstr@ctthesistitle}%
  \@bsfield{\degreeordep@rtmentname}{\degreeordep@rtment}%
  %\noindent%
  %\parbox[t]{\fnamelenA}{\mytextsf{\majorname}}%
  %\hspace{1ex}%
  %\parbox[t]{\abstractwidth-\fnamelenA-\fnamelenB-\ftextlen-3ex}{%
%	\raggedright\m@jor{}%
  %}%
  %\hfill%
  %\parbox[t]{\fnamelenB}{\mytextsf{\codename}}%
  %\hspace{1ex}%
  %\parbox[t]{\ftextlen}{\Cod@}%
  %\@bsbre@k%
  \iftoggle{Lic}{}{% Major not used for Lic. thesis
	\@bsfield{\majorname}{\m@jor}%
  }%
  \ifnumequal{\value{advisors}}{0}{%
	\@bsfield{\supervisorname}{\sup@rvis@r}%
  }{%
	\@bsfield{\supervisorname}{\sup@rvis@r}%
	\@bsfield{\advisorname}{\Advis@r{1}%
	\ifnumgreater{\value{advisors}}{1}{, \Advis@r{2}}{}}%
  }%
  \ifdefvoid{\coll@bp@rtner}{}{% Add collaborative partner row if specified
  	\@bsfield{\collaborativepartnername}{\coll@bp@rtner}%
  }%
  \iftoggle{Lic}{%
  	\@bsfield{\datename}{\D@te}%
  	\noindent%
  	\parbox[t]{\abstractwidth}{%
	  \mytextsf{\nofpgsname}\hspace{1ex}\shownumberofpages%
	  \hfill\mytextsf{\langname}\hspace{1ex}\L@ng{#1}%
  	}%
  }{%
	\noindent%
	\parbox[t]{\abstractwidth}{%
	  \mytextsf{\datename}\hspace{1ex}{\selectlanguage{\AbstractLang}\D@te{}}\hfill%
	  \mytextsf{\nofpgsname}\hspace{1ex}\shownumberofpages%
	  \hfill\mytextsf{\langname}\hspace{1ex}\L@ng{#1}%
	}%
  }%
  \@bsbre@k%
  \vspace{2pt}%
%
  \noindent\mytextsf{\abstractname}\\%
  \ifdefstrequal{\MainLang}{\AbstractLang}{}{\begin{otherlanguage*}{#1}}%
}{% At end enviroment do the followoing:
  \ifdefstrequal{\MainLang}{\AbstractLang}{}{\end{otherlanguage*}}%
  \vspace{2pt}%
  \@bsbre@k%
  \@bsfield{\keywordsname}{\k@ywords\par\vspace{0.3ex}}%
  \setcounter{advisors}{0}%
  \clearpage%
  \fancyhead{}%
  \cfoot{\thepage}%
  \pagestyle{fancy}%
}%
%%%%%% Abstract stuff ends here %%%%%%
%
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
%%%%%% Write the metadata
\newcommand{\makemetadata}{%
  \iftoggle{writexmpdatafile}{%
    % Write the metadata into file .xmpdat, which is included in the PDF/A file
	\newoutputstream{xmpdata}%
	\openoutputfile{\jobname.xmpdata}{xmpdata}%
	\addtostream{xmpdata}{\noexpand\Title {\pdfth@sistitl@}}%
	\addtostream{xmpdata}{\noexpand\Author {\ThesisAuthor}}%
	\addtostream{xmpdata}{\noexpand\Language {\MetaDataLang}}
	\addtostream{xmpdata}{\noexpand\Copyright {\MetaCopyrightText}}%
	\addtostream{xmpdata}{\noexpand\CopyrightURL {\pdfCopyrightURL}}
	\addtostream{xmpdata}{\noexpand\Subject {\abstracttext}}%
	\addtostream{xmpdata}{\noexpand\Keywords {\k@ywords}}%
	\closeoutputstream{xmpdata}%
  }{%
    % Write the metadata directly into the pdf file via hyperref keywords
	\renewcommand*{\spc}{; }%
	\hypersetup{%
	  pdftitle={\pdfth@sistitl@},%
	  pdfauthor={\ThesisAuthor},%
	  pdfsubject={\abstracttext},%
	  pdflang={\MetaDataLang}
	  pdfcopyright={\MetaCopyrightText},%
	  pdfkeywords={\k@ywords}%
	}%
  }%
}%
%
\AtBeginDocument{%
  \makemetadata%
}%
%
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
%% A few more macros
%%
%
\newcommand{\dothesispagenumbering}{%
  \fancyhead[L]{}%
  \fancyhead[R]{}%
  \cfoot{\thepage}%
  \pagestyle{fancy}%
}
%
\newcommand*{\mysection}[1]{%
  \newpage%
  \section*{#1}%
  \addcontentsline{toc}{section}{#1}%
}%
%
%% \phantomsection is the command used by hyperref to set a bookmark to 
%% starred sections so that links have the right target, e.g. in a toc.
%% \phantomsection is a dummy command without the hyperref package.
%\AtBeginDocument{\providecommand*{\phantomsection}{}}%
\newcommand{\thesistableofcontents}{%
  \phantomsection%
  \addcontentsline{toc}{section}{\contentsname}%
  \tableofcontents%
}%
%
\newcommand{\thesisappendix}{%
  \stor@maintxtpag@number%
  \appendix%
  \counterwithin{equation}{section}%
  \renewcommand{\theequation}{\thesection\arabic{equation}}%
  \counterwithin{figure}{section}%
  \renewcommand{\thefigure}{\thesection\arabic{figure}}%
  \renewcommand{\theHfigure}{\thesection\arabic{figure}}% for hyperref
  \counterwithin{table}{section}%
  \renewcommand{\thetable}{\thesection\arabic{table}}%
  \renewcommand{\theHtable}{\thesection\arabic{table}}% for hyperref
}%
%
\newcommand*{\thesisbibliography}{%
  \phantomsection%
  \addcontentsline{toc}{section}{\refname}%
}%
%
\AtBeginDocument{\pagestyle{myheadings}}%
%
%% Creative Commons license Finnish translations for use with doclicense.sty.
%% To be removed when Finnish is supported by doclicense. 
\newcommand{\MyMetadataText}{\doclicense@lang@thisDoc \ \doclicense@type \ \doclicense@modifier \ \doclicense@version \ \doclicense@lang@word@license}
%
\AtEndPreamble{%
  \@ifpackageloaded{doclicense}{%
  \IfFin{\MainLang}{%
	\def\doclicense@UrlLangPart{/deed.fi}%
	\edef\doclicenseURL{% Set up the URL
	\doclicense@baseUrlCC/%
	licenses/%
	\doclicense@modifier/%
	\doclicense@versionUsed\doclicense@UrlLangPart%
	}%
%
	\@namedef{doclicense@lang@thisDoc}{Tämä teos on lisensoitu}%
	\@namedef{doclicense@lang@word@license}{ -käyttöluvalla}%
%
	\@namedef{doclicense@lang@lic@CC@code}{fi}%
% Using: https://en.wikipedia.org/wiki/ISO_639-1
%
	\@namedef{doclicense@lang@lic@CC@zero@1.0}{CC0 1.0 Yleismaailmallinen}%
%
	\@namedef{doclicense@lang@lic@CC@by@3.0}{Nimeä 3.0 Ei sovitettu}%
	\@namedef{doclicense@lang@lic@CC@by-sa@3.0}{Nimeä-JaaSamoin 3.0 Ei sovitettu}%
	\@namedef{doclicense@lang@lic@CC@by-nd@3.0}{Nimeä-EiMuutoksia 3.0 Ei sovitettu}%
	\@namedef{doclicense@lang@lic@CC@by-nc@3.0}{Nimeä-EiKaupallinen 3.0 Ei sovitettu}%
	\@namedef{doclicense@lang@lic@CC@by-nc-sa@3.0}{Nimeä-EiKaupallinen-JaaSamoin 3.0 Ei sovitettu}%
	\@namedef{doclicense@lang@lic@CC@by-nc-nd@3.0}{Nimeä-EiKaupallinen-EiMuutoksia 3.0 Ei sovitettu}%
%
	\@namedef{doclicense@lang@lic@CC@by@4.0}{Nimeä 4.0 Kansainvälinen}%
	\@namedef{doclicense@lang@lic@CC@by-sa@4.0}{Nimeä-JaaSamoin 4.0 Kansainvälinen}%
	\@namedef{doclicense@lang@lic@CC@by-nd@4.0}{Nimeä-EiMuutoksia 4.0 Kansainvälinen}%
	\@namedef{doclicense@lang@lic@CC@by-nc@4.0}{Nimeä-EiKaupallinen 4.0 Kansainvälinen}%
	\@namedef{doclicense@lang@lic@CC@by-nc-sa@4.0}{Nimeä-EiKaupallinen-JaaSamoin 4.0 Kansainvälinen}%
	\@namedef{doclicense@lang@lic@CC@by-nc-nd@4.0}{Nimeä-EiKaupallinen-EiMuutoksia 4.0 Kansainvälinen}%
  }{}%
  }{}%
}%
\endinput
