#pragma once
#include <stdexcept>
#include <wx/string.h>
#define THROW_IO_ERROR( msg ) throw std::runtime_error( wxString( msg ).ToStdString() )
